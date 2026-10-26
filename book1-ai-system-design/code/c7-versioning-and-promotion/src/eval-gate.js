// eval-gate.js
//
// The eval gate: run a prompt version against a GOLDEN SET (a fixed list of
// test cases with known-good expectations) and refuse to promote it if the
// pass rate is below a threshold.
//
// Each golden case says: for this HCP, this approved content, and this rep
// request, the brief MUST contain certain strings (the HCP's name, the
// approved content ID) and MUST NOT contain others (off-label terms such as
// "pediatric" or "cure"). These are simple string checks. That is deliberate:
// they are cheap, deterministic, and easy for a compliance reviewer to read.
// Production gates add richer graders (an LLM-as-judge rubric, human review
// of a sample), see Chapter 12.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mockGenerate } from "./mock-model.js";

// Fill {{variable}} placeholders. A missing value is an error, not a blank:
// a silently empty "Approved content:" section is the worst possible outcome.
export function renderTemplate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!(name in values)) throw new Error(`Missing prompt variable: ${name}`);
    const value = values[name];
    if (Array.isArray(value)) return value.map((c) => `[${c.content_id}] ${c.text}`).join("\n");
    return String(value);
  });
}

export function loadGoldenSet(path) {
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// Score one case: every must_include present, every must_not_include absent.
// Matching ignores upper and lower case.
function scoreCase(output, testCase) {
  const text = output.toLowerCase();
  const missing = testCase.must_include.filter((s) => !text.includes(s.toLowerCase()));
  const forbidden = testCase.must_not_include.filter((s) => text.includes(s.toLowerCase()));
  return { id: testCase.id, pass: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

// Run the whole golden set against one prompt artifact.
// `generate` is the model function; tests and the demo use the mock.
export function runEvalGate({ prompt, cases, contentById, threshold, generate = mockGenerate }) {
  const results = cases.map((testCase) => {
    const variables = {
      hcp_name: testCase.hcp_name,
      specialty: testCase.specialty,
      rep_request: testCase.rep_request,
      approved_content: testCase.content_ids.map((id) => contentById[id]),
    };
    const output = generate(renderTemplate(prompt.template, variables), variables);
    return scoreCase(output, testCase);
  });
  const passed = results.filter((r) => r.pass).length;
  const passRate = passed / results.length;
  return { prompt: `${prompt.name}@${prompt.version}`, passed, total: results.length, passRate, threshold, ok: passRate >= threshold, results };
}

// Convenience loader used by the CLI and by promote.js: reads config, golden
// set, and approved content relative to the example folder.
export function evalPrompt(baseDir, prompt, config) {
  const goldenPath = config.golden_sets[prompt.name];
  if (!goldenPath) throw new Error(`No golden set configured for prompt ${prompt.name}`);
  const content = JSON.parse(readFileSync(join(baseDir, "data", "approved-content.json"), "utf8"));
  const contentById = Object.fromEntries(content.items.map((c) => [c.content_id, c]));
  const cases = loadGoldenSet(join(baseDir, goldenPath));
  return runEvalGate({ prompt, cases, contentById, threshold: config.eval_threshold });
}
