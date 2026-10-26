// Protocol-level tests: agent card discovery, JSON-RPC method names, task
// states, and A2A error codes. These talk to a real HTTP server on a free port.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createComplianceChecker } from "../src/compliance-checker.js";
import { discoverAgent, sendMessage, getTask, callA2A } from "../src/a2a-client.js";
import { AGENT_CARD_PATH, METHODS, TaskState, Role, ErrorCode, newMessage, dataPart } from "../src/a2a.js";

let checker, baseUrl, endpoint;
before(async () => {
  checker = createComplianceChecker();
  baseUrl = await checker.start();
  ({ endpoint } = await discoverAgent(baseUrl));
});
after(() => checker.stop());

const review = (data, ids) => newMessage(Role.USER, [dataPart(data)], ids);
const rawPost = (headers, body) =>
  fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...headers }, body }).then((r) => r.json());

test("agent card is served at the well-known path with the required A2A 1.0 fields", async () => {
  const card = await (await fetch(baseUrl + AGENT_CARD_PATH)).json();
  for (const field of ["name", "description", "supportedInterfaces", "version", "capabilities", "defaultInputModes", "defaultOutputModes", "skills"]) {
    assert.ok(card[field] !== undefined, `card is missing ${field}`);
  }
  assert.equal(AGENT_CARD_PATH, "/.well-known/agent-card.json");
  assert.deepEqual(Object.keys(card.supportedInterfaces[0]).sort(), ["protocolBinding", "protocolVersion", "url"]);
  assert.equal(card.supportedInterfaces[0].protocolBinding, "JSONRPC");
  for (const field of ["id", "name", "description", "tags"]) assert.ok(card.skills[0][field]);
});

test("method names are the A2A 1.0 PascalCase names", () => {
  assert.equal(METHODS.SEND_MESSAGE, "SendMessage");
  assert.equal(METHODS.GET_TASK, "GetTask");
  assert.equal(METHODS.CANCEL_TASK, "CancelTask");
});

test("SendMessage returns {task} with a terminal state, an artifact, and history", async () => {
  const task = await sendMessage(endpoint, review({ product: "Zentivra", talking_points: ["Zentivra is taken once daily."] }));
  assert.equal(task.status.state, TaskState.COMPLETED);
  assert.equal(task.artifacts[0].parts[0].data.verdict, "PASS");
  assert.equal(task.history.length, 2); // the request and the agent's reply
  assert.equal(task.history[1].role, Role.AGENT);
});

test("an off-label claim is flagged with the rule and the matched words", async () => {
  const task = await sendMessage(endpoint, review({ product: "Zentivra", talking_points: ["Approved in adults.", "Great for pediatric patients."] }));
  const verdict = task.artifacts[0].parts[0].data;
  assert.equal(verdict.verdict, "BLOCK");
  assert.deepEqual(verdict.findings.map((f) => [f.point_index, f.rule_id, f.matched]), [[1, "OFF_LABEL_POPULATION", "pediatric"]]);
});

test("each rule type fires: unapproved indication, absolute claim, comparative claim", async () => {
  const points = ["Also lowers blood pressure.", "It cures heart failure.", "Better than the leading brand."];
  const task = await sendMessage(endpoint, review({ product: "Zentivra", talking_points: points }));
  const rules = task.artifacts[0].parts[0].data.findings.map((f) => f.rule_id).sort();
  assert.deepEqual(rules, ["ABSOLUTE_CLAIM", "UNAPPROVED_INDICATION", "UNSUPPORTED_COMPARATIVE"]);
});

test("a product with no approved label is REJECTED (the agent declines the task)", async () => {
  const task = await sendMessage(endpoint, review({ product: "Unknownex", talking_points: ["Anything."] }));
  assert.equal(task.status.state, TaskState.REJECTED);
});

test("GetTask finds a task later, honours historyLength, and errors for unknown ids", async () => {
  const task = await sendMessage(endpoint, review({ product: "Lumotrex", talking_points: ["Improved lung function at week 12."] }));
  const again = await getTask(endpoint, task.id, 1);
  assert.equal(again.status.state, TaskState.COMPLETED);
  assert.equal(again.history.length, 1);
  await assert.rejects(getTask(endpoint, "no-such-task"), (err) => err.code === ErrorCode.TASK_NOT_FOUND && err.code === -32001);
});

test("terminal tasks accept no new messages and cannot be canceled", async () => {
  const task = await sendMessage(endpoint, review({ product: "Zentivra", talking_points: ["Once daily."] }));
  await assert.rejects(sendMessage(endpoint, review({}, { taskId: task.id })), (err) => err.code === ErrorCode.UNSUPPORTED_OPERATION);
  await assert.rejects(callA2A(endpoint, METHODS.CANCEL_TASK, { id: task.id }), (err) => err.code === ErrorCode.TASK_NOT_CANCELABLE);
});

test("JSON-RPC errors: missing version header, bad JSON, unknown and unsupported methods, bad params", async () => {
  const body = (method, params = {}) => JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  assert.equal((await rawPost({}, body("GetTask", { id: "x" }))).error.code, -32009); // no header means 0.3
  assert.equal((await rawPost({ "A2A-Version": "1.0" }, "{not json")).error.code, -32700);
  assert.equal((await rawPost({ "A2A-Version": "1.0" }, body("message/send"))).error.code, -32601); // old 0.x name
  assert.equal((await rawPost({ "A2A-Version": "1.0" }, body("SendStreamingMessage"))).error.code, -32004);
  assert.equal((await rawPost({ "A2A-Version": "1.0" }, body("SendMessage", { message: { parts: [] } }))).error.code, -32602);
});
