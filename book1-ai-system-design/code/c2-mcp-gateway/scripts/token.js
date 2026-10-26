#!/usr/bin/env node
// token.js
//
// Prints a demo bearer token so you can call a running gateway by hand.
//   node scripts/token.js                 field rep rep.jlee, territory T-NE-101
//   node scripts/token.js brand_analyst   brand analyst analyst.mchen
// Demo only: real tokens come from your identity provider (see Example C3).

import { issueDevToken } from '../src/auth.js';

const PEOPLE = {
  field_rep: { user: 'rep.jlee', territories: ['T-NE-101'], agent: 'precall-planner' },
  brand_analyst: { user: 'analyst.mchen', territories: ['T-NE-101', 'T-NE-102', 'T-SE-201'], agent: 'brand-insights-bot' },
  mlr_reviewer: { user: 'mlr.sgarcia', territories: ['T-NE-101'], agent: 'mlr-assistant' },
};
const role = process.argv[2] || 'field_rep';
if (!PEOPLE[role]) throw new Error(`Unknown role ${role}. Try: ${Object.keys(PEOPLE).join(', ')}`);
console.log(await issueDevToken({ ...PEOPLE[role], role }));
