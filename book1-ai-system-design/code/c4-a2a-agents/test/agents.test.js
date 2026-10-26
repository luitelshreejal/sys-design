// Agent-to-agent tests: the planner calls the checker over A2A, refuses when
// the checker blocks a claim, pauses for missing input, and fails closed when
// the checker is unreachable.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createComplianceChecker } from "../src/compliance-checker.js";
import { createPrecallPlanner } from "../src/precall-planner.js";
import { discoverAgent, sendMessage } from "../src/a2a-client.js";
import { TaskState, Role, newMessage, textPart, dataPart } from "../src/a2a.js";

let checker, planner, endpoint;
const transitions = [];
before(async () => {
  checker = createComplianceChecker({ onTransition: (t) => transitions.push(t) });
  const checkerUrl = await checker.start();
  planner = createPrecallPlanner({ checkerUrl, onTransition: (t) => transitions.push(t) });
  ({ endpoint } = await discoverAgent(await planner.start()));
});
after(async () => {
  await planner.stop();
  await checker.stop();
});

const ask = (data, ids) => newMessage(Role.USER, [textPart("Prepare me."), dataPart(data)], ids);

test("on-label request: planner COMPLETED, plan carries the checker's PASS and task id", async () => {
  const task = await sendMessage(endpoint, ask({ hcp_npi: "9000000060", product: "Zentivra" }));
  assert.equal(task.status.state, TaskState.COMPLETED);
  const plan = task.artifacts[0].parts[0].data;
  assert.deepEqual(plan.talking_points.map((p) => p.content_id), ["ZEN-CORE-001", "ZEN-DOSE-002"]);
  assert.equal(plan.compliance.verdict, "PASS");
  assert.ok(checker.tasks.has(plan.compliance.checker_task_id), "the audit id points at a real checker task");
});

test("planner moves through SUBMITTED, WORKING, then the final state; checker work happens inside WORKING", async () => {
  transitions.length = 0;
  const task = await sendMessage(endpoint, ask({ hcp_npi: "9000000060", product: "Zentivra" }));
  const story = transitions.map((t) => `${t.agent}:${t.to}`);
  assert.deepEqual(story, [
    "Pre-call Planner:TASK_STATE_SUBMITTED",
    "Pre-call Planner:TASK_STATE_WORKING",
    "Compliance Checker:TASK_STATE_SUBMITTED",
    "Compliance Checker:TASK_STATE_WORKING",
    "Compliance Checker:TASK_STATE_COMPLETED",
    "Pre-call Planner:TASK_STATE_COMPLETED",
  ]);
  assert.equal(task.status.state, TaskState.COMPLETED);
});

test("off-label claim: planner refuses (REJECTED), returns findings, and no plan artifact", async () => {
  const task = await sendMessage(endpoint, ask({
    hcp_npi: "9000000011",
    product: "Zentivra",
    extra_points: ["Zentivra also works well for her teenage patients with heart failure."],
  }));
  assert.equal(task.status.state, TaskState.REJECTED);
  assert.equal(task.artifacts.length, 0);
  const details = task.status.message.parts.find((p) => "data" in p).data;
  assert.equal(details.verdict, "BLOCK");
  assert.equal(details.findings[0].rule_id, "OFF_LABEL_POPULATION");
  assert.match(details.findings[0].text, /teenage/);
});

test("missing product: INPUT_REQUIRED, then the same task completes after the rep answers", async () => {
  const first = await sendMessage(endpoint, ask({ hcp_npi: "9000000060" }));
  assert.equal(first.status.state, TaskState.INPUT_REQUIRED);
  const second = await sendMessage(endpoint, ask({ product: "Zentivra" }, { taskId: first.id, contextId: first.contextId }));
  assert.equal(second.id, first.id);
  assert.equal(second.status.state, TaskState.COMPLETED);
});

test("unknown HCP: planner REJECTED", async () => {
  const task = await sendMessage(endpoint, ask({ hcp_npi: "9999999999", product: "Zentivra" }));
  assert.equal(task.status.state, TaskState.REJECTED);
});

test("checker unreachable: planner fails closed (FAILED, no plan)", async () => {
  const lonely = createPrecallPlanner({ checkerUrl: "http://127.0.0.1:9" }); // port 9: nothing listens there
  const { endpoint: lonelyEndpoint } = await discoverAgent(await lonely.start());
  const task = await sendMessage(lonelyEndpoint, ask({ hcp_npi: "9000000060", product: "Zentivra" }));
  await lonely.stop();
  assert.equal(task.status.state, TaskState.FAILED);
  assert.equal(task.artifacts.length, 0);
});
