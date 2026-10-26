// Tests for the traced agent loop: span tree shape, budgets, and redaction.
// Spans are captured in memory with the official InMemorySpanExporter, plus
// our JSON file exporter writing to a temporary folder.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-node";
import { setupTracing } from "../src/tracing.js";
import { runAgent } from "../src/agent.js";
import { createMockModel } from "../src/model-mock.js";
import { redact, MASK } from "../src/redact.js";

const memory = new InMemorySpanExporter();
const jsonPath = join(mkdtempSync(join(tmpdir(), "c6-")), "trace.jsonl");
const { tracer } = setupTracing({ consoleOutput: false, jsonPath, exporters: [memory] });
beforeEach(() => memory.reset());

const question = "Prepare me for Dr. Patel tomorrow.";
const spans = () => memory.getFinishedSpans();
const byName = (prefix) => spans().filter((s) => s.name.startsWith(prefix));

test("span tree: one invoke_agent root; chat and execute_tool spans are its children, in order", async () => {
  const result = await runAgent({ question, model: createMockModel(), tracer });
  assert.equal(result.status, "completed");

  const [root] = byName("invoke_agent");
  assert.equal(root.name, "invoke_agent precall_prep_agent");
  assert.equal(root.kind, SpanKind.INTERNAL);
  assert.equal(root.parentSpanContext, undefined, "the root has no parent");
  assert.equal(root.attributes["gen_ai.operation.name"], "invoke_agent");

  const children = spans().filter((s) => s.parentSpanContext?.spanId === root.spanContext().spanId).sort((a, b) => a.startTime[0] - b.startTime[0] || a.startTime[1] - b.startTime[1]);
  assert.deepEqual(children.map((s) => s.name), [
    "chat claude-haiku-5-5",
    "execute_tool get_hcp_profile",
    "chat claude-haiku-5-5",
    "execute_tool get_recent_interactions",
    "execute_tool get_approved_content",
    "chat claude-haiku-5-5",
  ]);
  assert.equal(spans().length, 7, "nothing outside the tree");

  for (const chat of byName("chat ")) {
    assert.equal(chat.kind, SpanKind.CLIENT);
    for (const key of ["gen_ai.operation.name", "gen_ai.provider.name", "gen_ai.request.model", "gen_ai.response.id", "gen_ai.response.finish_reasons", "gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens"]) {
      assert.ok(key in chat.attributes, `${chat.name} missing ${key}`);
    }
    assert.equal(chat.attributes["gen_ai.provider.name"], "anthropic");
  }
  for (const tool of byName("execute_tool ")) {
    assert.equal(tool.kind, SpanKind.INTERNAL);
    assert.equal(tool.attributes["gen_ai.operation.name"], "execute_tool");
    assert.equal(tool.name, `execute_tool ${tool.attributes["gen_ai.tool.name"]}`);
    assert.match(tool.attributes["gen_ai.tool.call.id"], /^toolu_/);
  }
  // Root totals equal the sum of the chat spans.
  const sum = byName("chat ").reduce((n, s) => n + s.attributes["gen_ai.usage.input_tokens"], 0);
  assert.equal(root.attributes["gen_ai.usage.input_tokens"], sum);
});

test("step budget: a model that never stops is cut off after maxSteps model calls", async () => {
  const result = await runAgent({ question, model: createMockModel({ loop: true }), tracer, maxSteps: 3 });
  assert.equal(result.status, "budget_exceeded");
  assert.equal(result.answer, null);
  assert.equal(byName("chat ").length, 3);
  const [root] = byName("invoke_agent");
  assert.equal(root.status.code, SpanStatusCode.ERROR);
  assert.equal(root.attributes["error.type"], "step_budget_exceeded");
  assert.equal(root.attributes["app.agent.steps"], 3);
});

test("token budget: the loop stops as soon as total tokens pass the limit, without running more tools", async () => {
  const result = await runAgent({ question, model: createMockModel({ tokensPerCall: 5000 }), tracer, maxTotalTokens: 8000 });
  assert.equal(result.status, "budget_exceeded");
  assert.equal(byName("chat ").length, 2);
  assert.equal(byName("execute_tool ").length, 1, "the second call's tool requests were not executed");
  assert.equal(byName("invoke_agent")[0].attributes["error.type"], "token_budget_exceeded");
});

test("redaction: no HCP email, phone, or address anywhere in the trace, yet the rep's answer has the phone", async () => {
  const result = await runAgent({ question, model: createMockModel(), tracer });
  assert.match(result.answer, /617-555-0188/, "the model saw the real phone number");
  const everything = JSON.stringify(spans().map((s) => s.attributes));
  for (const secret of ["a.patel@beaconhillcardio.example", "617-555-0188", "40 Cambridge St"]) {
    assert.ok(!everything.includes(secret), `trace leaked ${secret}`);
  }
  assert.match(byName("execute_tool get_hcp_profile")[0].attributes["gen_ai.tool.call.result"], /"office_phone":"\[REDACTED\]"/);
});

test("redact(): masks sensitive keys and email or phone patterns inside text, leaves NPIs and dates alone", () => {
  const input = { npi: "9000000060", office_address: "40 Cambridge St", note: "Call 617-555-0188 or a.patel@x.example on 2026-09-30" };
  assert.deepEqual(redact(input), { npi: "9000000060", office_address: MASK, note: `Call ${MASK} or ${MASK} on 2026-09-30` });
});

test("a failing tool marks its span as an error and the agent keeps going", async () => {
  await runAgent({ question: "Prepare me for Dr. Nobody tomorrow.", model: createMockModel(), tracer, maxSteps: 2 });
  const [tool] = byName("execute_tool get_hcp_profile");
  assert.equal(tool.status.code, SpanStatusCode.ERROR);
  assert.equal(tool.attributes["error.type"], "tool_error");
  assert.equal(byName("chat ").length, 2, "the model was called again after the tool error");
});

test("the JSON file exporter writes one parseable span per line with parent links", () => {
  const lines = readFileSync(jsonPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(lines.length > 0);
  const ids = new Set(lines.map((s) => s.spanId));
  for (const span of lines) {
    assert.ok(span.parentSpanId === null || ids.has(span.parentSpanId), `${span.name} points at a known parent`);
    assert.equal(span.service, "precall-agent");
  }
  assert.ok(lines.some((s) => s.kind === "CLIENT" && s.name.startsWith("chat ")));
});
