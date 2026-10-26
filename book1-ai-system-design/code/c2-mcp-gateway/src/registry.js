// registry.js
//
// The approved-server registry. A person (platform owner plus security)
// reviews each upstream MCP server and its tool descriptions, then pins:
//   - the server version they reviewed, and
//   - a SHA-256 fingerprint of each tool definition they approved.
//
// Why pin descriptions? The model reads tool descriptions as instructions.
// A "rug pull" is when a server you approved later changes a description,
// for example to add hidden instructions that make the agent leak data.
// The tool name and code can stay the same, so nothing else would notice.
// Comparing fingerprints on every check catches it.

import { canonicalJson, sha256 } from './audit.js';

// The fingerprint covers everything the model reads about a tool: its name,
// description, input schema (parameter descriptions are read too), and
// annotations (a tool quietly switching readOnlyHint to false matters).
export function toolFingerprint(tool) {
  return sha256(canonicalJson({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations ?? null,
  }));
}

// Compare what an upstream server reports now against what was approved.
// Returns one verdict per tool the server offers:
//   { tool, status: 'approved' }  or  { tool, status: 'blocked', reason, ... }
export function checkUpstream(entry, serverVersion, tools) {
  // A version we did not review means nothing from this server is trusted.
  if (serverVersion?.version !== entry.version) {
    return tools.map((tool) => ({
      tool, status: 'blocked', reason: 'server_version_not_approved',
      expected: entry.version, actual: serverVersion?.version,
    }));
  }
  return tools.map((tool) => {
    const pinned = entry.tools[tool.name];
    if (!pinned) return { tool, status: 'blocked', reason: 'tool_not_in_registry' };
    const actual = toolFingerprint(tool);
    if (actual !== pinned.descriptionSha256) {
      return { tool, status: 'blocked', reason: 'tool_description_changed', expected: pinned.descriptionSha256, actual };
    }
    return { tool, status: 'approved' };
  });
}
