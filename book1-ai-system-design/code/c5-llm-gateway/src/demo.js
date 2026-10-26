// demo.js
//
// Starts the gateway on a free local port and sends it a series of requests
// that exercise each feature: routing, escalation, fallback on error,
// fallback on timeout, cache hit, budget exceeded, and streaming. Then prints
// the cost log and a per-team cost summary.
//
//   npm run demo        mock provider (default, no key, deterministic)
//   npm run demo:real   real Claude via the Anthropic SDK (needs ANTHROPIC_API_KEY)
//
// In both modes the outages are simulated with withFaults(), so you can watch
// fallback work without waiting for a real outage.

import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createGateway } from "./gateway.js";
import { createMockProvider } from "./providers/mock.js";
import { withFaults } from "./providers/faults.js";

const real = process.argv.includes("--real");
if (real && !process.env.ANTHROPIC_API_KEY) {
  console.error("demo:real needs ANTHROPIC_API_KEY. Run `npm run demo` for the mock version.");
  process.exit(1);
}
const base = real ? (await import("./providers/anthropic.js")).createAnthropicProvider() : createMockProvider();
const provider = withFaults(base);

const config = loadConfig();
config.timeout_ms = real ? 20000 : 300; // short in mock mode so the timeout scene is quick
const costLogPath = fileURLToPath(new URL("../logs/cost.jsonl", import.meta.url));
rmSync(costLogPath, { force: true }); // start each demo with an empty log

const gateway = createGateway({ config, providers: { anthropic: provider }, costLogPath });
const url = await gateway.start();

async function ask(label, team, user, body) {
  const res = await fetch(`${url}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-team-id": team, "x-user-id": user },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  console.log(`\n${label}`);
  if (res.status !== 200) return console.log(`  HTTP ${res.status} ${out.error.type}: ${out.error.message}`);
  console.log(`  HTTP 200 model=${out.model} (${out.route_reason})`);
  console.log(`  cache_hit=${out.cache_hit} fallback_from=${out.fallback_from ?? "none"} tokens=${out.usage.input_tokens}+${out.usage.output_tokens} cost=$${out.cost_usd}`);
  console.log(`  text: ${out.text.slice(0, 110)}${out.text.length > 110 ? "..." : ""}`);
}

const patel = { messages: [{ role: "user", content: "Summarize my last three calls with Dr. Patel in two sentences." }], max_tokens: 200 };

await ask("1. Simple rep question: small model first", "field-force-ai", "rep-jlee", patel);
await ask("2. Analysis task: escalated to the mid tier", "brand-analytics", "analyst-mchen", {
  task: "analysis",
  messages: [{ role: "user", content: "Compare Zentivra NRx trends in Boston North and Boston South for Q3 and suggest two hypotheses." }],
  max_tokens: 400,
});
await ask("3. High-stakes task from a team capped at the mid tier", "field-force-ai", "rep-jlee", {
  task: "high_stakes",
  messages: [{ role: "user", content: "Draft my quarterly business review summary." }],
  max_tokens: 300,
});

provider.setFault("claude-haiku-5-5", "error");
await ask("4. Haiku is overloaded (simulated): fallback to the next model", "field-force-ai", "rep-jlee", {
  messages: [{ role: "user", content: "What did Dr. Okafor ask about last time?" }], max_tokens: 200,
});
provider.setFault("claude-haiku-5-5", "timeout");
await ask(`5. Haiku hangs (simulated): gateway gives up after ${config.timeout_ms} ms and falls back`, "field-force-ai", "rep-jlee", {
  messages: [{ role: "user", content: "List my calls planned for Thursday." }], max_tokens: 200,
});
provider.setFault("claude-haiku-5-5", null);

await ask("6. Exact repeat of request 1: served from cache", "field-force-ai", "rep-jlee", patel);

const medInfo = { messages: [{ role: "user", content: "Summarize the latest medical information request themes." }], max_tokens: 250 };
await ask("7. medical-info team (600 tokens a day), first request", "medical-info", "msl-rgarcia", medInfo);
await ask("8. medical-info asks for a long answer (max_tokens 600): the worst case no longer fits", "medical-info", "msl-rgarcia", {
  messages: [{ role: "user", content: "Write a full narrative of every theme." }], max_tokens: 600,
});

console.log("\n9. Streaming passthrough (Server-Sent Events)");
const res = await fetch(`${url}/v1/messages`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-team-id": "field-force-ai", "x-user-id": "rep-jlee" },
  body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "Give me one opener for Dr. Reyes." }], max_tokens: 150 }),
});
const events = (await res.text()).split("\n\n").filter(Boolean).map((e) => ({ type: e.match(/^event: (\w+)/)[1], data: JSON.parse(e.match(/data: (.*)/)[1]) }));
const pieces = events.filter((e) => e.type === "text");
const done = events.find((e) => e.type === "done");
console.log(`  content-type=${res.headers.get("content-type")} text events=${pieces.length}`);
console.log(`  streamed text: ${pieces.map((e) => e.data.text).join("").slice(0, 110)}`);
console.log(`  final event: model=${done.data.model} cost=$${done.data.cost_usd}`);

console.log("\nCost log (logs/cost.jsonl), one line per request:");
console.log("  team             user            model              in   out  cost_usd   cache  status           fallback_from");
for (const e of gateway.costLog.readAll()) {
  console.log(`  ${e.team.padEnd(16)} ${e.user.padEnd(15)} ${String(e.model ?? "-").padEnd(18)} ${String(e.input_tokens).padStart(4)} ${String(e.output_tokens).padStart(4)}  ${e.cost_usd.toFixed(6)}  ${String(e.cache_hit).padEnd(5)}  ${e.status.padEnd(15)}  ${e.fallback_from ?? ""}`);
}

console.log("\nCost by team (placeholder prices):");
const byTeam = {};
for (const e of gateway.costLog.readAll()) byTeam[e.team] = (byTeam[e.team] ?? 0) + e.cost_usd;
for (const [team, cost] of Object.entries(byTeam)) console.log(`  ${team.padEnd(16)} $${cost.toFixed(6)}`);

console.log("\nBudgets today (GET /v1/usage):");
for (const row of await (await fetch(`${url}/v1/usage`)).json()) {
  console.log(`  ${row.team.padEnd(16)} used ${String(row.used).padStart(5)} of ${String(row.daily_token_budget).padStart(5)}, ${row.remaining} left`);
}
await gateway.stop();
