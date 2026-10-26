// Tests for the real Anthropic provider WITHOUT calling the API. We pass in a
// fake client that records the parameters and returns canned answers, so we
// can check the request shape and the error mapping offline.

import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicProvider } from "../src/providers/anthropic.js";

function fakeClient(reply) {
  const sent = [];
  const api = (namespace) => ({
    create: async (params) => {
      sent.push({ namespace, params });
      if (reply instanceof Error) throw reply;
      return reply;
    },
  });
  return { sent, messages: api("messages"), beta: { messages: api("beta.messages") } };
}
const ok = { model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "Hi Dr. Patel" }], usage: { input_tokens: 12, output_tokens: 4 } };
const request = (model) => ({ model, max_tokens: 100, messages: [{ role: "user", content: "hi" }] });

test("Haiku uses messages.create with no sampling or thinking parameters", async () => {
  const client = fakeClient(ok);
  const result = await createAnthropicProvider({ client }).complete(request("claude-haiku-5-5"));
  assert.deepEqual(result, { model: "claude-haiku-5-5", text: "Hi Dr. Patel", usage: { input_tokens: 12, output_tokens: 4 } });
  assert.equal(client.sent[0].namespace, "messages");
  assert.deepEqual(Object.keys(client.sent[0].params).sort(), ["max_tokens", "messages", "model"]);
});

test("Sonnet and Opus opt into server-side refusal fallback on the beta namespace", async () => {
  for (const model of ["claude-sonnet-5-5", "claude-opus-5-5"]) {
    const client = fakeClient({ ...ok, model });
    await createAnthropicProvider({ client }).complete(request(model));
    assert.equal(client.sent[0].namespace, "beta.messages");
    assert.deepEqual(client.sent[0].params.betas, ["server-side-fallback-2026-07-01"]);
    assert.equal(client.sent[0].params.fallbacks, "default");
  }
});

test("a refusal becomes a non-retryable error, so the gateway does not try other models", async () => {
  const client = fakeClient({ ...ok, stop_reason: "refusal", content: [] });
  await assert.rejects(createAnthropicProvider({ client }).complete(request("claude-haiku-5-5")), (err) => err.kind === "refusal" && err.retryable === false);
});

test("SDK errors map to retryable or not", async () => {
  const cases = [
    [new Anthropic.APIConnectionTimeoutError(), "timeout", true],
    [new Anthropic.APIConnectionError({ message: "socket hang up" }), "connection", true],
  ];
  for (const [error, kind, retryable] of cases) {
    const client = fakeClient(error);
    await assert.rejects(createAnthropicProvider({ client }).complete(request("claude-haiku-5-5")), (err) => err.kind === kind && err.retryable === retryable);
  }
});
