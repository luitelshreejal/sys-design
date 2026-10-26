// Unit tests for the entitlement rules, with no MCP involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getHcpProfile, getBrandMetrics, searchApprovedContent } from '../src/data-product.js';

const bostonNorthRep = { userId: 'rep.jlee', role: 'field_rep', territories: ['T-NE-101'] };
const districtManager = { userId: 'dm.kpatel', role: 'district_manager', territories: ['T-NE-101', 'T-NE-102'] };

test('a rep can see an HCP in their own territory', () => {
  const p = getHcpProfile(bostonNorthRep, '9000000011');
  assert.equal(p.last_name, 'Okafor');
  assert.equal(p.trx_13wk.Zentivra, 184);
});

test('a rep cannot see an HCP outside their territory, and gets the same answer as for an unknown NPI', () => {
  assert.equal(getHcpProfile(bostonNorthRep, '9000000052'), null); // exists, Atlanta
  assert.equal(getHcpProfile(bostonNorthRep, '9999999999'), null); // does not exist
});

test('patient-level fields are never returned', () => {
  const p = getHcpProfile(districtManager, '9000000037');
  assert.ok(!('patient_level' in p));
  assert.ok(!JSON.stringify(p).includes('PT-'), 'no patient ids anywhere in the output');
});

test('brand metrics are limited to the caller territories', () => {
  const { rows } = getBrandMetrics(districtManager, 'Zentivra');
  const territories = new Set(rows.map((r) => r.territory_id));
  assert.deepEqual([...territories].sort(), ['T-NE-101', 'T-NE-102']);
});

test('asking for a territory you do not cover is refused, not answered with an empty list', () => {
  const result = getBrandMetrics(bostonNorthRep, 'Zentivra', 'T-SE-201');
  assert.match(result.error, /Not entitled/);
});

test('content search returns only approved, unexpired content', () => {
  const ids = searchApprovedContent('zentivra', 'Zentivra').map((c) => c.content_id);
  assert.deepEqual(ids.sort(), ['ZEN-CORE-001', 'ZEN-DOSE-002']);
  assert.deepEqual(searchApprovedContent('savings'), [], 'the only match is expired');
  assert.deepEqual(searchApprovedContent('draft'), [], 'drafts are invisible');
});
