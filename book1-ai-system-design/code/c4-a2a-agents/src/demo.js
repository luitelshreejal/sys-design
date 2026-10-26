// demo.js
//
// Runs both agents on this machine and plays the part of the rep's app.
//
//   rep app --A2A--> Pre-call Planner --A2A--> Compliance Checker
//
// Four scenarios: an on-label plan (COMPLETED), a plan with an off-label
// claim (planner REJECTED), a request missing the product (INPUT_REQUIRED,
// then continued), and an audit lookup with GetTask. Task IDs are random, so
// they differ on every run. Only the first 8 characters are printed.

import { createComplianceChecker } from "./compliance-checker.js";
import { createPrecallPlanner } from "./precall-planner.js";
import { discoverAgent, sendMessage, getTask, callA2A } from "./a2a-client.js";
import { Role, METHODS, newMessage, textPart, dataPart, textOf, dataOf } from "./a2a.js";

const short = (id) => id.slice(0, 8);
const onTransition = ({ agent, taskId, from, to }) => console.log(`    [${agent}] task ${short(taskId)}: ${from} -> ${to}`);

const checker = createComplianceChecker({ onTransition });
const checkerUrl = await checker.start();
const planner = createPrecallPlanner({ checkerUrl, onTransition });
const plannerUrl = await planner.start();

console.log("== Discovery: fetch the planner's agent card ==");
const { card, endpoint } = await discoverAgent(plannerUrl);
console.log(`  ${card.name} v${card.version}, skills: ${card.skills.map((s) => s.id).join(", ")}`);
console.log(`  endpoint: ${endpoint.replace(/:\d+/, ":<port>")} (JSONRPC, A2A ${card.supportedInterfaces[0].protocolVersion})`);

// The rep's app sends a short text part for humans plus a data part for machines.
const ask = (text, data, ids) => newMessage(Role.USER, [textPart(text), dataPart(data)], ids);

console.log("\n== Scenario 1: on-label plan for Dr. Patel ==");
const wire = (kind, body) => kind === "request" && console.log(`  wire request: ${JSON.stringify({ ...body, params: { message: { ...body.params.message, messageId: "<uuid>" } } })}`);
const t1 = await sendMessage(endpoint, ask("Prepare me for Dr. Patel tomorrow.", { hcp_npi: "9000000060", product: "Zentivra" }), { onWire: wire });
console.log(`  result: ${t1.status.state}: ${textOf(t1.status.message)}`);
const plan = t1.artifacts[0].parts[0].data;
plan.talking_points.forEach((p, i) => console.log(`    ${i + 1}. [${p.content_id}] ${p.text}`));
plan.rep_context.forEach((line) => console.log(`    rep only: ${line}`));
console.log(`    compliance: ${plan.compliance.verdict} (checker task ${short(plan.compliance.checker_task_id)})`);

console.log("\n== Scenario 2: the rep asks to add an off-label point ==");
const t2 = await sendMessage(endpoint, ask("Prepare me for Dr. Okafor. Add the point she asked about.", {
  hcp_npi: "9000000011",
  product: "Zentivra",
  extra_points: ["Zentivra also works well for her teenage patients with heart failure."],
}));
console.log(`  result: ${t2.status.state}: ${textOf(t2.status.message)}`);
console.log(`  artifacts returned to the rep: ${t2.artifacts.length}`);

console.log("\n== Scenario 3: no product given, so the planner asks (INPUT_REQUIRED) ==");
const t3 = await sendMessage(endpoint, ask("Prepare me for Dr. Patel.", { hcp_npi: "9000000060" }));
console.log(`  result: ${t3.status.state}: ${textOf(t3.status.message)}`);
const t3b = await sendMessage(endpoint, ask("Zentivra.", { product: "Zentivra" }, { taskId: t3.id, contextId: t3.contextId }));
console.log(`  same task ${short(t3b.id)} after the rep answers: ${t3b.status.state}`);

console.log("\n== Scenario 4: audit. Look up the rejected task later with GetTask ==");
const audit = await getTask(endpoint, t2.id, 1);
console.log(`  ${short(audit.id)} is ${audit.status.state}; findings: ${JSON.stringify(dataOf(audit.history[0]).findings.map((f) => f.rule_id))}`);
try {
  await callA2A(endpoint, METHODS.SEND_MESSAGE, { message: ask("Try again?", {}, { taskId: t2.id }) });
} catch (err) {
  console.log(`  sending to a finished task fails: error ${err.code} ${err.message}`);
}

await planner.stop();
await checker.stop();
