// providers/anthropic.js
//
// The real provider: calls Claude through the official Anthropic SDK
// (@anthropic-ai/sdk). It is used only by `npm run demo:real`, which needs
// ANTHROPIC_API_KEY. Tests and the default demo use the mock provider.
//
// It does three jobs:
//   1. Turn a gateway request into an SDK call (non-streaming or streaming).
//   2. Turn the SDK's answer into the gateway's simple { model, text, usage }.
//   3. Turn the SDK's typed errors into ProviderError with a `retryable` flag,
//      so the gateway's fallback logic stays vendor-neutral.
//
// Two layers of fallback. The gateway falls back between models when a call
// fails. For Sonnet 5.5 and Opus 5.5 we ALSO opt into Anthropic's server-side
// refusal fallback (fallbacks: "default"): if the model's safety classifier
// declines a request, the API retries it on a recommended fallback model
// inside the same call. Haiku 5.5 has no server-side fallback, so we do not
// send that parameter for Haiku.
//
// Note what we do NOT send: temperature, top_p, or top_k (current models
// reject them), or a thinking setting (these models use adaptive thinking
// by default).

import Anthropic from "@anthropic-ai/sdk";
import { ProviderError } from "./errors.js";

const SERVER_FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5"]);

export function createAnthropicProvider({ client = new Anthropic() } = {}) {
  // Build the SDK call. Returns the API namespace to use plus the parameters.
  function prepare({ model, system, messages, max_tokens }) {
    const params = { model, max_tokens, messages };
    if (system) params.system = system;
    if (SERVER_FALLBACK_MODELS.has(model)) {
      return { api: client.beta.messages, params: { ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } };
    }
    return { api: client.messages, params };
  }

  function toResult(message) {
    // A refusal arrives as a normal response with stop_reason "refusal".
    // Check it before reading the content. It is not retryable here.
    if (message.stop_reason === "refusal") {
      throw new ProviderError("refusal", `${message.model} declined the request`, { retryable: false, status: 422 });
    }
    const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
    return { model: message.model, text, usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens } };
  }

  return {
    name: "anthropic",
    async complete(request, { signal } = {}) {
      const { api, params } = prepare(request);
      try {
        return toResult(await api.create(params, { signal }));
      } catch (err) {
        throw toProviderError(err);
      }
    },
    async stream(request, { signal, onText } = {}) {
      const { api, params } = prepare(request);
      try {
        const stream = api.stream(params, { signal });
        stream.on("text", (delta) => onText(delta));
        return toResult(await stream.finalMessage());
      } catch (err) {
        throw toProviderError(err);
      }
    },
  };
}

// Most specific SDK error classes first. APIConnectionTimeoutError is a kind
// of APIConnectionError, so it must be checked before it.
function toProviderError(err) {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderError("aborted", "call aborted by the gateway", { retryable: true });
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("timeout", err.message, { retryable: true, status: 504 });
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError("connection", err.message, { retryable: true, status: 502 });
  if (err instanceof Anthropic.RateLimitError) return new ProviderError("rate_limit", err.message, { retryable: true, status: 429 });
  if (err instanceof Anthropic.InternalServerError) return new ProviderError("server_error", err.message, { retryable: true, status: 503 });
  if (err instanceof Anthropic.AuthenticationError) return new ProviderError("auth", err.message, { retryable: false, status: 502 });
  if (err instanceof Anthropic.BadRequestError) return new ProviderError("bad_request", err.message, { retryable: false, status: 400 });
  if (err instanceof Anthropic.APIError) return new ProviderError("api_error", err.message, { retryable: (err.status ?? 0) >= 500, status: 502 });
  return new ProviderError("unknown", String(err?.message ?? err), { retryable: false });
}
