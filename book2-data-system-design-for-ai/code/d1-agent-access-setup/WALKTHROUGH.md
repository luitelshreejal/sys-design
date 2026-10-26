## Example D1: Agent access setup (service user, roles, grants, and policies)

Code: `code/d1-agent-access-setup/`

### What this demonstrates

An AI agent needs its own identity in Snowflake, and that identity must be at least as tightly governed as a human analyst. This example builds that identity for a "field assistant" agent that answers questions for the Boston district sales team:

- a service user, `SVC_AGENT_FIELD`, that has no password and signs in with a key pair restricted to one role;
- a functional role, `AGENT_FIELD_READ`, built from three access roles, following the access-role and functional-role pattern in [Chapter 7 (Governance, Security, and Privacy)](chapters/07-governance-security-privacy.md), section 7.3;
- a dedicated warehouse capped by a resource monitor, the cost guardrail from [Chapter 14 (Architecture Patterns, Anti-Patterns, and Cost)](chapters/14-architecture-patterns-anti-patterns-and-cost.md);
- a network policy that limits where the service user can connect from;
- a territory row access policy and patient masking policies attached to the secure views the agent reads (Chapter 7, section 7.4);
- verification queries that a reviewer can run to prove all of the above.

The data it protects is the HCP 360 Prescriber Weekly data product specified in [Chapter 8 (Data Products and the Semantic Layer)](chapters/08-data-products-and-the-semantic-layer.md). The agent-facing picture is completed in [Chapter 16 (Exposing Governed Data to Agents on Snowflake)](chapters/16-exposing-governed-data-to-agents-on-snowflake.md).

### How to use it

Nothing here runs locally. The files are Snowflake SQL, meant to be run in order by a platform engineer in a non-production account:

| File | Run as | What it does |
|---|---|---|
| `00_sample_objects.sql` | SYSADMIN | Creates a small invented copy of the COMMERCIAL database (skip in a real account, where Example D6 and the pipelines create it) |
| `01_roles_and_service_user.sql` | USERADMIN, SECURITYADMIN | Access roles, functional role, service user, key pair |
| `02_warehouse_and_resource_monitor.sql` | ACCOUNTADMIN, SYSADMIN | Warehouse and monthly credit cap |
| `03_network_policy.sql` | SYSADMIN, SECURITYADMIN | Ingress network rule and network policy on the user |
| `04_policies_and_agent_views.sql` | SYSADMIN | Entitlement table, row access and masking policies, secure views |
| `05_grants.sql` | SECURITYADMIN | Least-privilege grants |
| `06_verify.sql` | SECURITYADMIN, then the service user | The review queries |

As a reviewer, you mostly read `04`, `05`, and `06`. If an engineer's pull request for an agent does not contain something equivalent to `06_verify.sql` with its results, ask for it.

### Walkthrough

**Step 1: an identity that cannot log in like a person.** `TYPE = SERVICE` means no password, no MFA enrolment, and no SSO. Secondary roles are switched off, so the agent can only ever use one role. The default `QUERY_TAG` is a JSON string, so every query the agent runs can be grouped by agent, tool, and trace in `QUERY_HISTORY`.

<!-- listing: 01_roles_and_service_user.sql | from: CREATE USER IF NOT EXISTS SVC_AGENT_FIELD | to: GRANT ROLE AGENT_FIELD_READ TO USER -->
```sql
CREATE USER IF NOT EXISTS SVC_AGENT_FIELD
  TYPE = SERVICE
  DEFAULT_ROLE = AGENT_FIELD_READ
  DEFAULT_WAREHOUSE = WH_AGENT_FIELD
  DEFAULT_SECONDARY_ROLES = ()
  COMMENT = 'Service identity for the field assistant agent. Key-pair only. Owner: Commercial Data. Review quarterly.'
  QUERY_TAG = '{"agent": "field", "tool": "none", "trace": "none"}';

-- The user needs the role before a key pair can be restricted to it.
USE ROLE SECURITYADMIN;
GRANT ROLE AGENT_FIELD_READ TO USER SVC_AGENT_FIELD;
```
<!-- /listing -->

**Step 2: a key that only opens one door, and expires.** A named key pair can be restricted to one role and given an expiry, so a leaked key cannot be used to assume any other role, and rotation is forced every 90 days.

<!-- listing: 01_roles_and_service_user.sql | from: ALTER USER SVC_AGENT_FIELD ADD KEY PAIR | to: COMMENT = 'Issued -->
```sql
ALTER USER SVC_AGENT_FIELD ADD KEY PAIR AGENT_FIELD_KEY_2026Q4
  PUBLIC_KEY = '<paste the public key body here, one line, no BEGIN/END lines>'
  ROLE_RESTRICTION = 'AGENT_FIELD_READ'
  DAYS_TO_EXPIRY = 90
  COMMENT = 'Issued 2026-10-23. Rotate before expiry. Ticket COMMDATA-1182.';
```
<!-- /listing -->

**Step 3: a warehouse with a ceiling.** The agent runs on its own extra-small warehouse. The resource monitor notifies at 50 and 80 percent of the monthly quota and suspends the warehouse at 100 percent. Statement timeouts stop a badly generated query from running for an hour.

<!-- listing: 02_warehouse_and_resource_monitor.sql | from: CREATE RESOURCE MONITOR IF NOT EXISTS | to: ON 110 PERCENT -->
```sql
CREATE RESOURCE MONITOR IF NOT EXISTS RM_AGENT_FIELD WITH
  CREDIT_QUOTA = 60                 -- credits per month; size from a pilot, then review
  FREQUENCY = MONTHLY
  START_TIMESTAMP = IMMEDIATELY
  TRIGGERS
    ON 50 PERCENT DO NOTIFY         -- early warning to account administrators
    ON 80 PERCENT DO NOTIFY
    ON 100 PERCENT DO SUSPEND       -- finish running queries, then stop
    ON 110 PERCENT DO SUSPEND_IMMEDIATE;  -- cancel running queries too
```
<!-- /listing -->

**Step 4: only from known addresses.** The network rule lists the agent runtime's egress IPs (documentation ranges here), and the policy is attached to the one user, not the account.

<!-- listing: 03_network_policy.sql | from: CREATE NETWORK RULE IF NOT EXISTS | to: ALTER USER SVC_AGENT_FIELD SET NETWORK_POLICY -->
```sql
CREATE NETWORK RULE IF NOT EXISTS PLATFORM_ADMIN.NETWORK.NR_AGENT_RUNTIME_IPS
  TYPE = IPV4
  VALUE_LIST = ('198.51.100.16/28', '203.0.113.40')
  MODE = INGRESS
  COMMENT = 'Egress IPs of the agent runtime (NAT gateway). Owner: Platform. Change via CHG ticket.';

CREATE NETWORK POLICY IF NOT EXISTS NP_AGENT_FIELD
  ALLOWED_NETWORK_RULE_LIST = ('PLATFORM_ADMIN.NETWORK.NR_AGENT_RUNTIME_IPS')
  COMMENT = 'SVC_AGENT_FIELD may connect only from the agent runtime.';

-- Attach the policy to the one user it is for (not to the whole account).
ALTER USER SVC_AGENT_FIELD SET NETWORK_POLICY = NP_AGENT_FIELD;
```
<!-- /listing -->

**Step 5: rows by territory.** The row access policy is the same pattern as Chapter 7, with one change: the argument is called `row_territory_id` so it cannot be confused with the mapping table's column. The service user appears in the entitlement table like any rep, mapped to the two Boston territories.

<!-- listing: 04_policies_and_agent_views.sql | from: CREATE ROW ACCESS POLICY IF NOT EXISTS | to: COMMENT = 'Rows visible -->
```sql
CREATE ROW ACCESS POLICY IF NOT EXISTS COMMERCIAL.GOVERNANCE.RAP_TERRITORY
  AS (row_territory_id VARCHAR) RETURNS BOOLEAN ->
    IS_ROLE_IN_SESSION('COMM_ALL_TERRITORIES')
    OR EXISTS (
      SELECT 1
      FROM COMMERCIAL.GOVERNANCE.USER_TERRITORY_MAP m
      WHERE m.user_name = CURRENT_USER()
        AND m.territory_id = row_territory_id
        AND CURRENT_DATE() BETWEEN m.effective_from AND m.effective_to
    )
  COMMENT = 'Rows visible only for territories mapped to the current user (BR-HCP-06). Owner: Commercial Data.';
```
<!-- /listing -->

**Step 6: patient fields that an agent never sees.** The first branch asks Snowflake whether the session is agent-active. That is true for Cortex Agents, the Snowflake-managed MCP server, agentic OAuth sessions, and `SERVICE_AGENT` users. Because it is checked before the role, a data scientist who holds `PATIENT_TOKEN_READ` still gets masked values when the question goes through an agent.

<!-- listing: 04_policies_and_agent_views.sql | from: CREATE MASKING POLICY IF NOT EXISTS COMMERCIAL.GOVERNANCE.MP_PATIENT_TOKEN | to: COMMENT = 'Patient token -->
```sql
CREATE MASKING POLICY IF NOT EXISTS COMMERCIAL.GOVERNANCE.MP_PATIENT_TOKEN
  AS (val VARCHAR) RETURNS VARCHAR ->
    CASE
      WHEN SYS_CONTEXT('SNOWFLAKE$CURRENT', 'IS_AGENT_ACTIVATED')::BOOLEAN = TRUE THEN '***MASKED***'
      WHEN IS_ROLE_IN_SESSION('PATIENT_TOKEN_READ') THEN val
      ELSE '***MASKED***'
    END
  COMMENT = 'Patient token: visible to PATIENT_TOKEN_READ only, never to agents.';
```
<!-- /listing -->

**Step 7: attach the policies to the agent's views.**

<!-- listing: 04_policies_and_agent_views.sql | from: ALTER VIEW COMMERCIAL.AGENT_SERVING.V_HCP_PRESCRIBER_WEEKLY | to: MODIFY COLUMN patient_birth_year -->
```sql
ALTER VIEW COMMERCIAL.AGENT_SERVING.V_HCP_PRESCRIBER_WEEKLY
  ADD ROW ACCESS POLICY COMMERCIAL.GOVERNANCE.RAP_TERRITORY ON (territory_id);

ALTER VIEW COMMERCIAL.AGENT_SERVING.V_HCP_DIM
  ADD ROW ACCESS POLICY COMMERCIAL.GOVERNANCE.RAP_TERRITORY ON (primary_territory_id);

ALTER VIEW COMMERCIAL.AGENT_SERVING.V_NBRX_PATIENT_EVENTS
  ADD ROW ACCESS POLICY COMMERCIAL.GOVERNANCE.RAP_TERRITORY ON (territory_id);

ALTER VIEW COMMERCIAL.AGENT_SERVING.V_NBRX_PATIENT_EVENTS
  MODIFY COLUMN patient_token SET MASKING POLICY COMMERCIAL.GOVERNANCE.MP_PATIENT_TOKEN;

ALTER VIEW COMMERCIAL.AGENT_SERVING.V_NBRX_PATIENT_EVENTS
  MODIFY COLUMN patient_zip3 SET MASKING POLICY COMMERCIAL.GOVERNANCE.MP_PATIENT_QUASI_ID_TEXT;

ALTER VIEW COMMERCIAL.AGENT_SERVING.V_NBRX_PATIENT_EVENTS
  MODIFY COLUMN patient_birth_year SET MASKING POLICY COMMERCIAL.GOVERNANCE.MP_PATIENT_QUASI_ID_NUMBER;
```
<!-- /listing -->

**Step 8: grants you can read in one minute.** Five named views, one future grant for semantic views, one warehouse, and nothing on the base tables.

<!-- listing: 05_grants.sql | from: GRANT USAGE ON DATABASE COMMERCIAL               TO ROLE AR_HCP360_AGENT_SELECT; | to: GRANT SELECT ON FUTURE SEMANTIC VIEWS -->
```sql
GRANT USAGE ON DATABASE COMMERCIAL               TO ROLE AR_HCP360_AGENT_SELECT;
GRANT USAGE ON SCHEMA COMMERCIAL.AGENT_SERVING   TO ROLE AR_HCP360_AGENT_SELECT;

GRANT SELECT ON VIEW COMMERCIAL.AGENT_SERVING.V_HCP_PRESCRIBER_WEEKLY TO ROLE AR_HCP360_AGENT_SELECT;
GRANT SELECT ON VIEW COMMERCIAL.AGENT_SERVING.V_HCP_DIM               TO ROLE AR_HCP360_AGENT_SELECT;
GRANT SELECT ON VIEW COMMERCIAL.AGENT_SERVING.V_PRODUCT_DIM           TO ROLE AR_HCP360_AGENT_SELECT;
GRANT SELECT ON VIEW COMMERCIAL.AGENT_SERVING.V_TERRITORY_DIM         TO ROLE AR_HCP360_AGENT_SELECT;
GRANT SELECT ON VIEW COMMERCIAL.AGENT_SERVING.V_NBRX_PATIENT_EVENTS   TO ROLE AR_HCP360_AGENT_SELECT;

-- -----------------------------------------------------------------------------
-- Access role: semantic views (created in Example D2)
-- Querying a semantic view needs SELECT on the semantic view only, not on the
-- tables or views behind it. Row access and masking policies on those views
-- still apply to the querying session.
-- -----------------------------------------------------------------------------
GRANT USAGE ON DATABASE COMMERCIAL TO ROLE AR_COMMERCIAL_SEMANTIC_SELECT;
GRANT USAGE ON SCHEMA COMMERCIAL.AI TO ROLE AR_COMMERCIAL_SEMANTIC_SELECT;
GRANT SELECT ON FUTURE SEMANTIC VIEWS IN SCHEMA COMMERCIAL.AI TO ROLE AR_COMMERCIAL_SEMANTIC_SELECT;
```
<!-- /listing -->

**Step 9: prove it.** The verification file lists, for each check, what a correct result looks like. The most important one asks Snowflake which policies are attached to the patient view.

<!-- listing: 06_verify.sql | from: SELECT policy_name, policy_kind | to: three -->
```sql
SELECT policy_name, policy_kind, ref_entity_name, ref_column_name, ref_arg_column_names, policy_status
FROM TABLE(
  COMMERCIAL.INFORMATION_SCHEMA.POLICY_REFERENCES(
    REF_ENTITY_NAME   => 'COMMERCIAL.AGENT_SERVING.V_NBRX_PATIENT_EVENTS',
    REF_ENTITY_DOMAIN => 'VIEW'
  )
);
-- Expected: RAP_TERRITORY (ROW_ACCESS_POLICY) on territory_id, and three
```
<!-- /listing -->

### What to notice

- **The agent is a user like any other, only stricter.** Same entitlement table, same row access policy, same masking policy. There is no "agent bypass". When Sales Ops asks why the agent cannot answer for Houston, the answer is in `USER_TERRITORY_MAP`, just as it would be for a rep.
- **Two layers protect patient fields.** The role check protects against the wrong role; the agent-active check protects against the right role used through an agent. Both are needed because an agent can be invoked on behalf of a human (delegated) or under its own identity (autonomous).
- **The views drop columns the agent never needs.** `consent_status` is Restricted in the HCP 360 data dictionary, so it is not in `V_HCP_DIM` at all. Not exposing a column is stronger than masking it.
- **The future grant is narrow.** It covers semantic views in one schema, which only the semantic layer team can create. A future grant on all tables in a database would quietly widen the agent's reach every time someone adds a table.
- **Delegated versus autonomous access.** If the agent runs as the signed-in rep (for example through OAuth from an MCP client, Example D3), `CURRENT_USER()` is the rep and the rep's own territories apply. If it runs as `SVC_AGENT_FIELD`, the service user's mapping applies. Decide which model each agent uses and write it in the spec.

### Verification status

| File | Status |
|---|---|
| `00_sample_objects.sql` | Standard DDL and DML. Not executed. |
| `01_roles_and_service_user.sql` | Syntax checked against CREATE USER, ALTER USER ... ADD KEY PAIR, Key-pair authentication, and Agent identity pages on docs.snowflake.com on 2026-10-23. Not executed. |
| `02_warehouse_and_resource_monitor.sql` | Syntax checked against CREATE RESOURCE MONITOR and CREATE WAREHOUSE on 2026-10-23. Not executed. |
| `03_network_policy.sql` | Syntax checked against CREATE NETWORK RULE, CREATE NETWORK POLICY, and ALTER USER on 2026-10-23. Not executed. |
| `04_policies_and_agent_views.sql` | Syntax checked against CREATE ROW ACCESS POLICY, CREATE MASKING POLICY, ALTER VIEW, and Agent identity on 2026-10-23. Not executed. The `SYS_CONTEXT('SNOWFLAKE$CURRENT', 'IS_AGENT_ACTIVATED')` condition follows the documented example; confirm it is enabled in your account. |
| `05_grants.sql` | Syntax checked against GRANT privileges, the semantic view privileges section, and the MCP server access control section on 2026-10-23. Not executed. |
| `06_verify.sql` | Syntax checked against SHOW GRANTS, POLICY_REFERENCES, and SHOW USER KEY PAIRS on 2026-10-23. Not executed. |

### What production would add

- Policies attached to the base tables in `HCP360` and `PATIENT` as well as the agent views, and tag-based masking so every column classified `PATIENT_ID` is masked by one policy (Chapter 7, "Object tags and tag-based masking").
- A dedicated policy administration role with `APPLY ROW ACCESS POLICY` and `APPLY MASKING POLICY`, instead of `SYSADMIN` owning the policies.
- Small-cell protection for patient counts (for example an aggregation policy or a minimum group size), because an agent that can count NBRx events per HCP per week could reveal individual patients at low counts. Check current Snowflake docs for aggregation policies.
- Key rotation automated by the platform team, with an alert before `DAYS_TO_EXPIRY` runs out, and the private key held only in the secrets manager.
- The whole setup in Terraform (Example D6) so that dev, test, and prod are identical and every change is reviewed as a plan.
- A quarterly access review that runs `06_verify.sql` and files the output with the data owner's sign-off.
- An evaluation of `TYPE = SERVICE_AGENT` for this user, which marks every session as agent-active and labels its queries `EXTERNAL_AGENT` in `QUERY_HISTORY`.
