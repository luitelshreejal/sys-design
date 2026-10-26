-- =============================================================================
-- Example D2, file 03: a Cortex Agent that uses the semantic view and search
-- -----------------------------------------------------------------------------
-- Syntax checked against these docs.snowflake.com pages on 2026-10-23:
--   "CREATE AGENT" (https://docs.snowflake.com/en/sql-reference/sql/create-agent)
--   "Cortex Agents REST API", schemas AgentInstructions, OrchestrationConfig,
--     BudgetConfig, ToolSpec, ToolResource, ExecutionEnvironment
--     (https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-rest-api)
--   "Inaccessible tool handling" (orchestration.tool_not_accessible)
--     (https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-inaccessible-tool-handling)
-- Not verified: not executed (no Snowflake account in the authoring environment).
--   Snowflake notes that a successful CREATE AGENT does not prove the tool
--   specifications are valid. Test the agent (file 04) before release.
--
-- What a Cortex Agent is
--   A Snowflake object that holds an agent specification (YAML): which model
--   plans the work, which tools it may call, instructions, and budgets. When
--   it runs, it decides which tool to call: Cortex Analyst (text to SQL over
--   the semantic view) for numbers, Cortex Search for approved content. It
--   runs with the caller's role, so all D1 grants and policies apply.
--
-- Choices made here and why
--   tool_not_accessible: reject  If the calling role has lost a grant on the
--                                semantic view or search service, the run
--                                fails with an error that lists the missing
--                                tools, instead of the agent quietly
--                                answering with fewer tools.
--   budget                       Hard limits on seconds and tokens per run,
--                                so one question cannot run up a large bill.
--   execution_environment        Generated SQL runs on WH_AGENT_FIELD, the
--                                capped warehouse from Example D1.
--   filter on audience           The agent only retrieves FIELD_INTERNAL
--                                content, never HCP-facing pieces it might
--                                paraphrase into an unapproved claim.
-- =============================================================================

USE ROLE SYSADMIN;

CREATE OR REPLACE AGENT COMMERCIAL.AI.FIELD_ASSISTANT
  COPY GRANTS
  COMMENT = 'Field assistant for the Boston district: TRx, NRx, NBRx, share, and approved content. Owner: Commercial Data. Spec version 1.0.0.'
  PROFILE = '{"display_name": "Field Assistant (HCP 360)", "color": "blue"}'
  FROM SPECIFICATION
  $$
  models:
    orchestration: auto

  orchestration:
    tool_not_accessible: reject
    budget:
      seconds: 60
      tokens: 20000

  instructions:
    system: "You help pharmaceutical sales representatives understand prescribing trends for HCPs in their territories. You use only the tools provided. You never give medical advice and never discuss individual patients."
    orchestration: "Use hcp360_metrics for any question about TRx, NRx, NBRx, or market share. Use approved_content for questions about messaging, objection handling, or what may be said about a product. If a question needs both, call hcp360_metrics first."
    response: "Be brief. State the week ending date and the data-through date for every number. Show market share as a percentage with one decimal. When quoting content, give the document title and MLR approval ID, and quote rather than paraphrase."
    sample_questions:
      - question: "What was Cardiozen TRx and market share in Boston North for the latest week?"
      - question: "Which HCPs in my territories had the most NBRx for Cardiozen last week?"
      - question: "How should I respond to a prior authorization concern about Cardiozen?"

  tools:
    - tool_spec:
        type: "cortex_analyst_text_to_sql"
        name: "hcp360_metrics"
        description: "Answers questions about TRx, NRx, NBRx, and TRx market share by HCP, territory, district, product, market, and week, using the certified HCP 360 semantic view. Results are limited to the caller's territories."
    - tool_spec:
        type: "cortex_search"
        name: "approved_content"
        description: "Searches MLR-approved, field-internal content (visual aid text, objection handlers, Prescribing Information excerpts). Returns passages with document title and approval ID."

  tool_resources:
    hcp360_metrics:
      semantic_view: "COMMERCIAL.AI.SV_HCP360_PRESCRIBER_WEEKLY"
      execution_environment:
        type: "warehouse"
        warehouse: "WH_AGENT_FIELD"
        query_timeout: 60
    approved_content:
      search_service: "COMMERCIAL.AI.CSS_APPROVED_FIELD_CONTENT"
      max_results: 5
      title_column: "document_title"
      id_column: "chunk_id"
      filter:
        "@eq":
          audience: "FIELD_INTERNAL"
  $$;
