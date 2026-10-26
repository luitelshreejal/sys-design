// registry.js
//
// Reads and writes the registry on disk. The registry has two kinds of file:
//
//   1. ARTIFACTS, which never change once written:
//        registry/tools/<tool name>/<version>.json
//        registry/prompts/<prompt name>/<version>.json
//      Think of them like rows in an append-only table. If you want to change
//      a tool, you write a NEW version file; you never edit an old one. That
//      is what lets you roll back with confidence.
//
//   2. ENVIRONMENT POINTERS, which do change:
//        registry/environments/dev.json, test.json, prod.json
//      Each one says "in this environment, use get_hcp_profile 1.1.0 and
//      precall_brief 1.0.0". Promotion is nothing more than copying pointers
//      from one environment file to the next, after the checks pass.
//
// In production the registry is often a database table or a service (for
// example an MCP registry or a prompt management tool). Plain JSON files in
// Git are a perfectly good start: every change gets a reviewable diff.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The two kinds of artifact, and the folder each one lives in.
export const KINDS = { tools: "tools", prompts: "prompts" };

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadEnvironment(root, env) {
  return readJson(join(root, "environments", `${env}.json`));
}

export function saveEnvironment(root, env, data) {
  writeFileSync(join(root, "environments", `${env}.json`), JSON.stringify(data, null, 2) + "\n");
}

// Load one artifact and check that the version inside the file matches the
// file name. A mismatch means someone copied a file and forgot to update it,
// which would make every later check meaningless.
export function loadArtifact(root, kind, name, version) {
  const artifact = readJson(join(root, KINDS[kind], name, `${version}.json`));
  if (artifact.version !== version) {
    throw new Error(`${kind}/${name}/${version}.json says version ${artifact.version}`);
  }
  return artifact;
}
