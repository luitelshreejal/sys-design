// config.js
//
// Loads the gateway policy file (config/gateway.config.json) and holds two
// small helpers every other file needs: a rough token estimate and a price
// lookup.
//
// Why a config file instead of code: routing rules, budgets, and prices are
// policy. A platform team should be able to change "medical-info gets 600
// tokens a day" without a code release, and reviewers should be able to read
// the policy in one place. In production this file would live in a config
// service or a versioned repo (see Example C7) rather than next to the code.

import { readFileSync } from "node:fs";

const DEFAULT_CONFIG_URL = new URL("../config/gateway.config.json", import.meta.url);

export function loadConfig(url = DEFAULT_CONFIG_URL) {
  return JSON.parse(readFileSync(url, "utf8"));
}

// Rough token estimate: about 4 characters per token for English text.
// Good enough for routing and budget checks BEFORE a call. Real tokenizers
// differ, so production gateways use the provider's token counting endpoint
// or tokenizer, and always charge budgets with the ACTUAL usage the provider
// reports after the call.
export function estimateTokens(text) {
  return Math.ceil(String(text ?? "").length / 4);
}

// Estimated input tokens for a whole request (system prompt plus every message).
export function estimateRequestTokens({ system, messages }) {
  const all = [system ?? "", ...messages.map((m) => m.content)].join("\n");
  return estimateTokens(all);
}

// Cost in US dollars for one call, using the PLACEHOLDER price table.
// Prices are per 1,000,000 tokens, which is how providers usually quote them.
export function costUsd(config, model, inputTokens, outputTokens) {
  const price = config.prices[model];
  if (!price) return 0;
  const dollars = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  // Round to 6 decimal places so log lines stay readable.
  return Math.round(dollars * 1e6) / 1e6;
}
