// server.js
//
// Runs the gateway as a long-lived local server (npm start), so you can send
// it requests yourself with curl. Uses the mock provider unless you pass
// --real (which needs ANTHROPIC_API_KEY).
//
//   curl -s localhost:8787/v1/messages -H 'content-type: application/json' \
//     -H 'x-team-id: field-force-ai' -H 'x-user-id: rep-jlee' \
//     -d '{"messages":[{"role":"user","content":"Summarize my last call with Dr. Patel."}]}'

import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createGateway } from "./gateway.js";
import { createMockProvider } from "./providers/mock.js";

const real = process.argv.includes("--real");
if (real && !process.env.ANTHROPIC_API_KEY) {
  console.error("--real needs ANTHROPIC_API_KEY to be set. Without it, run `npm start` for mock mode.");
  process.exit(1);
}
const provider = real
  ? (await import("./providers/anthropic.js")).createAnthropicProvider()
  : createMockProvider();

const gateway = createGateway({
  config: loadConfig(),
  providers: { anthropic: provider },
  costLogPath: fileURLToPath(new URL("../logs/cost.jsonl", import.meta.url)),
});
const port = Number(process.env.PORT ?? 8787);
const url = await gateway.start(port);
console.log(`LLM gateway (${real ? "real Anthropic" : "mock"} provider) listening on ${url}`);
