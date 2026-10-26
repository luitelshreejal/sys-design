// audit.js
//
// Append-only audit log in JSONL format: one JSON object per line, one line
// per decision. JSONL loads straight into Snowflake (COPY INTO a VARIANT
// column) or any log tool, and a half-written last line cannot corrupt the
// lines before it.
//
// We store a HASH of the arguments, not the arguments themselves, so the
// audit log does not become a second copy of sensitive data. An investigator
// who knows the arguments of a suspect call can hash them and find the line.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

// JSON with keys sorted, so {a:1,b:2} and {b:2,a:1} hash the same.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export class AuditLog {
  constructor(path) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  // Record one tool-call decision.
  // decision is "allow" or "deny"; reason explains a deny.
  record({ user, agent, tool, args, decision, reason, latencyMs, redactions }) {
    this.write({
      event: 'tool_call',
      user,
      agent,
      tool,
      args_sha256: sha256(canonicalJson(args ?? {})),
      decision,
      reason: reason ?? null,
      latency_ms: latencyMs,
      redactions: redactions ?? 0,
    });
  }

  // Record anything else worth keeping, such as a detected rug pull.
  write(entry) {
    appendFileSync(this.path, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  }
}
