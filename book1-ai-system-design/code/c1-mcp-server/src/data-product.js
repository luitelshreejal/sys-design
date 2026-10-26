// data-product.js
//
// This file stands in for the Snowflake HCP 360 data product. In production
// these functions would run SQL against secure views, and Snowflake row access
// policies and masking policies would do the filtering. Here we read a local
// JSON file and apply the same rules in plain JavaScript so you can see them.
//
// Nothing in this file knows about MCP. Keeping the data rules separate from
// the protocol code means the rules can be tested on their own, and the same
// rules would apply no matter which agent or protocol calls them.

import { readFileSync } from 'node:fs';

const FIXTURE_URL = new URL('../data/hcp360.json', import.meta.url);
const data = JSON.parse(readFileSync(FIXTURE_URL, 'utf8'));

// The data product snapshot date. Used to decide whether content has expired,
// so the example gives the same answer no matter what day you run it.
export const AS_OF = data.as_of;

// ALLOW-LIST of HCP fields an agent may see. We list what IS allowed rather
// than what is NOT allowed. If an engineer later adds a new column to the
// data product (say, patient_level.new_thing), it stays hidden by default.
// Patient-level fields are deliberately absent from this list.
const HCP_FIELDS_FOR_AGENTS = [
  'npi', 'first_name', 'last_name', 'specialty', 'hco_name', 'territory_id',
  'decile', 'segment', 'preferred_channel', 'office_phone', 'office_email',
  'last_call_date', 'trx_13wk', 'nrx_13wk',
];

// Copy only the allowed fields into a new object.
function projectAllowedFields(hcp) {
  const out = {};
  for (const field of HCP_FIELDS_FOR_AGENTS) out[field] = hcp[field];
  return out;
}

// The entitlement rule: a caller may see a territory only if it is listed
// in their own territories. A field rep has one; a district manager has several.
export function canSeeTerritory(caller, territoryId) {
  return caller.territories.includes(territoryId);
}

// Look up one HCP by NPI. Returns null both when the NPI does not exist and
// when the caller is not entitled to it. Giving the same answer in both cases
// means a caller cannot probe for HCPs outside their territory.
export function getHcpProfile(caller, npi) {
  const hcp = data.hcps.find((h) => h.npi === npi);
  if (!hcp || !canSeeTerritory(caller, hcp.territory_id)) return null;
  return projectAllowedFields(hcp);
}

// Weekly TRx (total prescriptions), NRx (new prescriptions), and market share
// for one brand, limited to the caller's territories. If the caller asks for a
// specific territory they are not entitled to, we refuse rather than silently
// returning an empty list, because an empty list could be misread as "zero sales".
export function getBrandMetrics(caller, brand, territoryId) {
  if (territoryId && !canSeeTerritory(caller, territoryId)) {
    return { error: `Not entitled to territory ${territoryId}.` };
  }
  const rows = data.brand_metrics.filter(
    (r) =>
      r.brand.toLowerCase() === brand.toLowerCase() &&
      canSeeTerritory(caller, r.territory_id) &&
      (!territoryId || r.territory_id === territoryId),
  );
  return { brand, as_of: AS_OF, rows };
}

// Search approved promotional content. Only content that is MLR-approved and
// not expired on the snapshot date is ever returned. Drafts and expired
// pieces are invisible to agents, so an agent cannot quote them to an HCP.
// Content is not territory-restricted: approved content is the same everywhere.
export function searchApprovedContent(query, brand) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return data.approved_content
    .filter((c) => c.status === 'approved' && c.expires_on >= AS_OF)
    .filter((c) => !brand || c.brand.toLowerCase() === brand.toLowerCase())
    .map((c) => {
      const haystack = `${c.title} ${c.text}`.toLowerCase();
      const score = words.filter((w) => haystack.includes(w)).length;
      return { ...c, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

// A plain-English data dictionary, exposed as an MCP resource. Agents (and
// people) can read it to learn what the fields mean. Notice it documents the
// patient-level fields as "never exposed", which is itself useful information.
export function dataDictionary() {
  return {
    data_product: 'HCP 360 (fixture standing in for Snowflake)',
    as_of: AS_OF,
    fields: {
      npi: 'National Provider Identifier (10 digits). Fixture NPIs start with 9 and are fake.',
      decile: 'Prescribing volume decile within specialty, 10 = highest.',
      segment: 'Brand team segmentation label.',
      trx_13wk: 'Total prescriptions, last 13 weeks, by brand.',
      nrx_13wk: 'New prescriptions, last 13 weeks, by brand.',
      office_phone: 'Office phone. Business contact data, may be redacted by the gateway.',
      office_email: 'Office email. Business contact data, may be redacted by the gateway.',
      patient_level: 'NEVER EXPOSED to agents. Patient-level detail stays in Snowflake.',
    },
    territories: data.territories,
  };
}
