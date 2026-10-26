// tools.js
//
// The local tools the agent can call. Each tool has two halves:
//   - a DEFINITION the model sees (name, description, input_schema in JSON
//     Schema), in the format the Anthropic Messages API expects, and
//   - an IMPLEMENTATION our code runs when the model asks for it.
//
// The data comes from data/crm.json, which stands in for CRM and content
// data products. In production each tool would be a call to a governed data
// product or an MCP server (see Example C1), with the rep's entitlements
// applied before any row comes back.
//
// Note that get_hcp_profile returns office email, phone, and address. The rep
// legitimately needs them to plan a visit, so the MODEL sees them. The TRACE
// must not, which is why src/redact.js exists.

import { readFileSync } from "node:fs";

const crm = JSON.parse(readFileSync(new URL("../data/crm.json", import.meta.url), "utf8"));
const REP_TERRITORY = "T-NE-101"; // the signed-in rep's territory (Jordan Lee)

export const toolDefinitions = [
  {
    name: "get_hcp_profile",
    description: "Look up an HCP in the rep's territory by last name. Returns NPI, specialty, organization, segment, preferred channel, office contact details, and 13-week TRx.",
    input_schema: {
      type: "object",
      properties: { last_name: { type: "string", description: "HCP last name, for example Patel" } },
      required: ["last_name"],
      additionalProperties: false,
    },
  },
  {
    name: "get_recent_interactions",
    description: "Recent rep interactions with one HCP, newest first: date, channel, topics, samples left, and notes.",
    input_schema: {
      type: "object",
      properties: {
        npi: { type: "string", description: "The HCP's 10-digit NPI" },
        limit: { type: "integer", description: "How many interactions to return (1 to 5)" },
      },
      required: ["npi"],
      additionalProperties: false,
    },
  },
  {
    name: "get_approved_content",
    description: "MLR-approved, unexpired content for a brand and specialty. Only these messages may be used with HCPs.",
    input_schema: {
      type: "object",
      properties: {
        brand: { type: "string", enum: ["Zentivra", "Lumotrex"] },
        specialty: { type: "string", description: "HCP specialty, for example Cardiology" },
      },
      required: ["brand", "specialty"],
      additionalProperties: false,
    },
  },
];

const implementations = {
  get_hcp_profile({ last_name }) {
    const hcp = crm.hcps.find((h) => h.territory_id === REP_TERRITORY && h.last_name.toLowerCase() === String(last_name).toLowerCase());
    if (!hcp) throw new Error(`no HCP named ${last_name} in territory ${REP_TERRITORY}`);
    return hcp;
  },
  get_recent_interactions({ npi, limit = 3 }) {
    const rows = crm.interactions.filter((i) => i.npi === npi).sort((a, b) => b.date.localeCompare(a.date));
    return rows.slice(0, Math.min(Math.max(limit, 1), 5));
  },
  get_approved_content({ brand, specialty }) {
    // Filter on status AND expiry date, using the data snapshot date so the
    // answer does not change depending on the day you run the example.
    return crm.approved_content
      .filter((c) => c.brand === brand && c.specialties.includes(specialty))
      .filter((c) => c.status === "approved" && c.expires_on >= crm.as_of)
      .map(({ content_id, title, text, mlr_approval_id }) => ({ content_id, title, text, mlr_approval_id }));
  },
};

// Run one tool by name. Throws for unknown tools or bad input, and the agent
// loop turns a throw into an is_error tool result the model can react to.
export async function runTool(name, input) {
  const fn = implementations[name];
  if (!fn) throw new Error(`unknown tool ${name}`);
  return fn(input ?? {});
}

export const describeTool = (name) => toolDefinitions.find((t) => t.name === name)?.description;
