// Interop test: the OFFICIAL A2A JavaScript SDK (@a2a-js/sdk, which
// implements A2A 1.0) talks to our hand-rolled checker. If the SDK can find
// our card, send a message, and read the task back, our wire format matches
// the spec closely enough for a real client. The SDK is a devDependency only;
// the example code itself does not use it.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ClientFactory } from "@a2a-js/sdk/client";
import { TaskState, Role } from "@a2a-js/sdk";
import { createComplianceChecker } from "../src/compliance-checker.js";

let checker, baseUrl;
before(async () => {
  checker = createComplianceChecker();
  baseUrl = await checker.start();
});
after(() => checker.stop());

// The SDK uses its own in-memory shapes (generated from the A2A protobuf
// definitions): enums are numbers and a part is { content: { $case, value } }.
// It converts them to and from the JSON wire format for us.
function sdkMessage(data) {
  return {
    messageId: randomUUID(),
    role: Role.ROLE_USER,
    parts: [{ content: { $case: "data", value: data }, mediaType: "application/json" }],
  };
}

test("the official SDK discovers our agent card and sends a message", async () => {
  const client = await new ClientFactory().createFromUrl(baseUrl);
  assert.equal(client.protocolVersion, "1.0");

  const task = await client.sendMessage({ message: sdkMessage({ product: "Zentivra", talking_points: ["Safe for children too."] }) });
  assert.equal(task.status.state, TaskState.TASK_STATE_COMPLETED);
  const verdict = task.artifacts[0].parts[0].content.value;
  assert.equal(verdict.verdict, "BLOCK");
  assert.equal(verdict.findings[0].rule_id, "OFF_LABEL_POPULATION");

  const again = await client.getTask({ id: task.id });
  assert.equal(again.status.state, TaskState.TASK_STATE_COMPLETED);
});

test("the official SDK sees REJECTED for an out-of-scope product", async () => {
  const client = await new ClientFactory().createFromUrl(baseUrl);
  const task = await client.sendMessage({ message: sdkMessage({ product: "Unknownex", talking_points: ["x"] }) });
  assert.equal(task.status.state, TaskState.TASK_STATE_REJECTED);
});
