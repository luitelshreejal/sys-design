// demo.js
//
// Rep Jordan Lee asks: "Prepare me for Dr. Patel tomorrow."
// Run 1 lets the agent finish. Run 2 uses a misbehaving model that never
// stops asking for tools, to show the step budget ending the run.
//
//   npm run demo                 mock model (default, no API key)
//   npm run demo:real            real Claude (claude-haiku-5-5), needs ANTHROPIC_API_KEY
//   npm run demo -- --quiet      skip the long console span dump
//
// Every span goes to the console (official ConsoleSpanExporter) and to
// traces/trace.jsonl. At the end we read the file back and print each trace
// as an indented tree.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setupTracing } from "./tracing.js";
import { runAgent } from "./agent.js";
import { createMockModel } from "./model-mock.js";

const real = process.argv.includes("--real");
if (real && !process.env.ANTHROPIC_API_KEY) {
  console.error("demo:real needs ANTHROPIC_API_KEY. Run `npm run demo` for the mock version.");
  process.exit(1);
}
const jsonPath = fileURLToPath(new URL("../traces/trace.jsonl", import.meta.url));
const { provider, tracer } = setupTracing({ consoleOutput: !process.argv.includes("--quiet"), jsonPath });
const model = real ? (await import("./model-claude.js")).createClaudeModel() : createMockModel();
const question = "Prepare me for Dr. Patel tomorrow.";

console.log(`== Run 1: "${question}" (${real ? "real" : "mock"} model, max 6 steps) ==`);
const run1 = await runAgent({ question, model, tracer, maxSteps: 6, conversationId: "conv-jlee-0001" });
console.log(`\nstatus=${run1.status} steps=${run1.steps} tokens=${run1.usage.input}+${run1.usage.output}`);
console.log(`answer shown to the rep:\n${run1.answer}`);

console.log("\n== Run 2: a model that never stops calling tools (max 3 steps) ==");
const run2 = await runAgent({ question, model: createMockModel({ loop: true }), tracer, maxSteps: 3, conversationId: "conv-jlee-0002" });
console.log(`\nstatus=${run2.status} steps=${run2.steps} answer=${run2.answer}`);
await provider.forceFlush();

// Read the JSON file back and print one tree per trace.
const spans = readFileSync(jsonPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
const show = (s) => {
  const a = s.attributes;
  const bits = [s.kind, `${Math.round(s.durationMs)} ms`];
  if (a["gen_ai.usage.input_tokens"] !== undefined) bits.push(`tokens ${a["gen_ai.usage.input_tokens"]}+${a["gen_ai.usage.output_tokens"]}`);
  if (a["gen_ai.response.finish_reasons"]) bits.push(`finish ${a["gen_ai.response.finish_reasons"].join(",")}`);
  if (a["app.agent.status"]) bits.push(`status ${a["app.agent.status"]}`);
  if (a["error.type"]) bits.push(`error.type ${a["error.type"]}`);
  return `${s.name}  [${bits.join(", ")}]`;
};
function printTree(parentId, depth, list) {
  for (const s of list.filter((x) => x.parentSpanId === parentId).sort((x, y) => x.startMs - y.startMs)) {
    console.log(`${"  ".repeat(depth)}${show(s)}`);
    printTree(s.spanId, depth + 1, list);
  }
}
for (const traceId of [...new Set(spans.map((s) => s.traceId))]) {
  const list = spans.filter((s) => s.traceId === traceId);
  console.log(`\nTrace ${traceId.slice(0, 8)}... (${list.length} spans, from traces/trace.jsonl)`);
  printTree(null, 1, list);
}

const profileSpan = spans.find((s) => s.name === "execute_tool get_hcp_profile");
console.log("\nWhat the trace stored for get_hcp_profile (gen_ai.tool.call.result):");
console.log(`  ${profileSpan.attributes["gen_ai.tool.call.result"]}`);
const lastChat = spans.filter((s) => s.name.startsWith("chat ") && s.traceId === spans.at(0).traceId).at(-1);
const storedAnswer = JSON.parse(lastChat.attributes["gen_ai.output.messages"])[0].content[0].text;
console.log("\nThe same answer line, as stored in the trace (gen_ai.output.messages) and as shown to the rep:");
console.log(`  trace: ${storedAnswer.split("\n")[1]}`);
console.log(`  rep:   ${run1.answer.split("\n")[1]}`);
await provider.shutdown();
