// model-claude.js
//
// The real model, used only by `npm run demo:real` (needs ANTHROPIC_API_KEY).
// It has the same small interface as the mock: an `id` and a `create()` that
// returns an Anthropic Messages API response.
//
// About tracing: the Anthropic SDK can emit its own OpenTelemetry spans
// (named anthropic.messages.create). We turn that off with
// `openTelemetry: false` so each model call appears once in the trace, as the
// "chat <model>" span our agent loop creates with the GenAI attribute names.
// That keeps the span tree identical in mock and real mode. In your own
// systems, the SDK's built-in spans are a good alternative to hand-made ones.
//
// Request rules we follow for the current Claude models: no temperature,
// top_p, or top_k; no thinking setting (adaptive thinking is the default);
// tool_choice left at its default ("auto"). For Sonnet 5.5 and Opus 5.5 we
// opt into the API's server-side refusal fallback. Haiku 5.5 has none.

import Anthropic from "@anthropic-ai/sdk";

const SERVER_FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5"]);

export function createClaudeModel({ id = "claude-haiku-5-5", client = new Anthropic({ openTelemetry: false }) } = {}) {
  return {
    id,
    async create({ system, messages, tools, max_tokens }) {
      const params = { model: id, max_tokens, system, messages, tools };
      if (SERVER_FALLBACK_MODELS.has(id)) {
        return client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
      }
      return client.messages.create(params);
    },
  };
}
