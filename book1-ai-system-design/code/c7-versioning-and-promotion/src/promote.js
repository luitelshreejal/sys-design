// promote.js
//
// Promotion: move the tool and prompt versions that are live in one
// environment (say test) into the next one (say prod), but ONLY if every rule
// passes. The rules, in order:
//
//   1. Path rule. Only dev -> test and test -> prod. No skipping test, no
//      going backwards. (Rollback is a separate, deliberate procedure.)
//   2. Version rule. For every tool and prompt whose version differs, the
//      detected change level (schema-diff.js, prompt-diff.js) must match the
//      version bump exactly (semver.js).
//   3. Eval rule. Every prompt in the candidate environment must pass its
//      golden set at or above the threshold (eval-gate.js).
//
// If everything passes, the target environment file is rewritten with the new
// pointers. Nothing else changes: artifacts are immutable, so "deploying" is
// just changing which version a pointer names.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvironment, saveEnvironment, loadArtifact, KINDS } from "./registry.js";
import { classifyToolChange } from "./schema-diff.js";
import { classifyPromptChange } from "./prompt-diff.js";
import { checkBump, parse } from "./semver.js";
import { evalPrompt } from "./eval-gate.js";

const classifiers = { tools: classifyToolChange, prompts: classifyPromptChange };

export function loadConfig(baseDir) {
  return JSON.parse(readFileSync(join(baseDir, "config", "promotion.json"), "utf8"));
}

// Rule 1: the next step on the path, and only the next step.
export function checkPath(from, to, path) {
  const i = path.indexOf(from);
  const j = path.indexOf(to);
  if (i === -1 || j === -1) return { ok: false, reason: `unknown environment (${from} -> ${to})` };
  if (j !== i + 1) return { ok: false, reason: `${from} -> ${to} is not allowed; promotions go ${path.join(" -> ")}, one step at a time` };
  return { ok: true };
}

// Rule 2 for one tool or prompt.
function checkItem(registryDir, kind, name, fromVersion, toVersion) {
  const item = { kind, name, from: fromVersion, to: toVersion };
  if (fromVersion === toVersion) return { ...item, status: "unchanged", ok: true };
  if (toVersion === undefined) return { ...item, status: "blocked", ok: false, reason: "removing an item is not done by promotion" };
  if (fromVersion === undefined) {
    parse(toVersion); // throws on a malformed version
    return { ...item, status: "new", ok: true, reason: "new item, no earlier version to compare" };
  }
  const oldArtifact = loadArtifact(registryDir, kind, name, fromVersion);
  const newArtifact = loadArtifact(registryDir, kind, name, toVersion);
  const { level, changes } = classifiers[kind](oldArtifact, newArtifact);
  const bump = checkBump(fromVersion, toVersion, level);
  return { ...item, status: bump.ok ? "ok" : "blocked", ok: bump.ok, level, bump: bump.bump, reason: bump.reason, changes };
}

export function promote({ baseDir, registryDir = join(baseDir, "registry"), from, to, dryRun = false, config = loadConfig(baseDir) }) {
  const path = checkPath(from, to, config.promotion_path);
  if (!path.ok) return { ok: false, from, to, reason: path.reason, items: [], evals: [], written: false };

  const source = loadEnvironment(registryDir, from);
  const target = loadEnvironment(registryDir, to);

  // Rule 2: compare every tool and prompt, current target version vs candidate.
  const items = [];
  for (const kind of Object.keys(KINDS)) {
    const names = new Set([...Object.keys(source[kind]), ...Object.keys(target[kind])]);
    for (const name of [...names].sort()) {
      items.push(checkItem(registryDir, kind, name, target[kind][name], source[kind][name]));
    }
  }

  // Rule 3: evaluate every prompt as it would be in the candidate environment.
  const evals = Object.entries(source.prompts).map(([name, version]) =>
    evalPrompt(baseDir, loadArtifact(registryDir, "prompts", name, version), config));

  const ok = items.every((i) => i.ok) && evals.every((e) => e.ok);
  let written = false;
  if (ok && !dryRun) {
    saveEnvironment(registryDir, to, { ...target, tools: { ...source.tools }, prompts: { ...source.prompts }, promoted_from: from });
    written = true;
  }
  return { ok, from, to, items, evals, written, dryRun };
}
