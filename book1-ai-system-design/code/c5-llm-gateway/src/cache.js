// cache.js
//
// An exact-match response cache. If the same team sends exactly the same
// request again (same tier, system prompt, messages, and max_tokens), the
// gateway returns the stored answer: no model call, no tokens, no cost.
//
// The cache key is a SHA-256 hash (a fixed-length fingerprint) of those
// fields written out in a fixed order. Change one character and the key
// changes, so there are no "close enough" hits.
//
// Why exact match and not "semantic" caching (reusing an answer to a question
// that merely looks similar)? In commercial pharma a near match is often a
// wrong answer: "Dr. Patel's Zentivra TRx" and "Dr. Patil's Zentivra TRx"
// look almost the same to an embedding model. Semantic caching needs careful
// evaluation and guardrails before it is safe here (see Chapter 8).
//
// The team is part of the key on purpose. Teams can have different data
// entitlements, so one team must never be served an answer that was built
// for another team.

import { createHash } from "node:crypto";

export function cacheKey({ team, tier, system, messages, max_tokens }) {
  const canonical = JSON.stringify([team, tier, system ?? "", messages.map((m) => [m.role, m.content]), max_tokens]);
  return createHash("sha256").update(canonical).digest("hex");
}

export function createCache({ ttlSeconds, now = () => Date.now() }) {
  const entries = new Map(); // key -> { value, expiresAt }
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= now()) {
        entries.delete(key); // stale answers are worse than no answer
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      entries.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
    },
    size: () => entries.size,
  };
}
