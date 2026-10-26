// router.js
//
// Model routing: decide which model tier answers a request.
//
// The rule is "small model first". Most rep questions ("summarize my last
// three calls with Dr. Patel") are easy, and a small model answers them well
// at a fraction of the cost. We only escalate when a rule says the request
// is harder:
//   - the caller labels the task as "analysis" or "multi_step", or
//   - the request is long (many input tokens), or
//   - the caller labels it "high_stakes", which goes to the large model.
// Each team also has a "max_tier" so a cost-sensitive team cannot quietly
// send everything to the most expensive model.
//
// The function returns the tier AND a plain-English reason. The reason is
// logged with every request, so a finance or platform reviewer can see why
// a request cost what it cost.

import { estimateRequestTokens } from "./config.js";

const TIER_ORDER = ["small", "mid", "large"];

export function chooseRoute(config, request, team) {
  const rules = config.routing;
  const task = request.task ?? "general";
  const inputTokens = estimateRequestTokens(request);

  // Step 1: start with the default tier, then let rules raise it.
  let tier = rules.default_tier;
  let reason = "default: small model first";

  if (rules.large_when.task_in.includes(task)) {
    tier = "large";
    reason = `escalated: task=${task}`;
  } else if (rules.escalate_to_mid_when.task_in.includes(task)) {
    tier = "mid";
    reason = `escalated: task=${task}`;
  } else if (inputTokens > rules.escalate_to_mid_when.estimated_input_tokens_over) {
    tier = "mid";
    reason = `escalated: about ${inputTokens} input tokens is over ${rules.escalate_to_mid_when.estimated_input_tokens_over}`;
  }

  // Step 2: apply the team's ceiling. A team capped at "mid" never reaches "large".
  const maxTier = config.teams[team]?.max_tier ?? "small";
  if (TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(maxTier)) {
    reason = `${reason}, capped at ${maxTier} for team ${team}`;
    tier = maxTier;
  }

  // Step 3: the fallback chain for that tier (tried in order by fallback.js).
  return { tier, reason, chain: config.fallback_chains[tier], inputTokens };
}
