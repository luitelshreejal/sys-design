// precall-planner.js
//
// The pre-call planner agent. A rep asks it to prepare for a visit with an
// HCP. It drafts talking points, then asks the compliance checker agent (over
// A2A) to review them before handing anything back to the rep.
//
// The planner's key rule: no plan leaves this agent without a PASS from the
// checker. If the checker says BLOCK, the planner refuses (task state
// REJECTED). If the checker cannot be reached or does not finish, the planner
// fails closed (task state FAILED) instead of skipping the check.
//
// The "drafting" step below is a deterministic stand-in for a model call, so
// the example runs with no API key. It copies approved content and then
// naively adds whatever extra points the rep asked for, which is exactly the
// kind of mistake a real model can make when a user pushes it.

import { readFileSync } from "node:fs";
import { createA2AServer } from "./a2a-server.js";
import { discoverAgent, hasSkill, sendMessage } from "./a2a-client.js";
import { CHECKER_SKILL_ID } from "./compliance-checker.js";
import { TaskState, Role, newMessage, textPart, dataPart, dataOf } from "./a2a.js";

const readJson = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8"));
const { hcps } = readJson("hcps.json");
const { products } = readJson("label-library.json");

export function plannerCard(endpointUrl) {
  return {
    name: "Pre-call Planner",
    description: "Prepares a compliant pre-call plan for a field rep's next HCP visit.",
    supportedInterfaces: [{ url: endpointUrl, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    provider: { organization: "Example Pharma Field Force AI (invented)", url: "https://fieldforce.example" },
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "precall-plan",
        name: "Pre-call plan",
        description: "Given an HCP NPI and a product, returns checked talking points and rep-only context.",
        tags: ["field-force", "pre-call", "hcp"],
        examples: ['{"hcp_npi":"9000000060","product":"Zentivra"}'],
      },
    ],
  };
}

// Stand-in for a model call: build a draft from approved content and HCP data.
export function draftPlan(hcp, request) {
  const label = products[request.product];
  const talkingPoints = label.approved_content.map((c) => ({ text: c.text, content_id: c.content_id }));
  for (const extra of request.extra_points ?? []) talkingPoints.push({ text: extra, content_id: null });
  const now = hcp.trx_13wk[request.product] ?? 0;
  const before = hcp.trx_13wk_prior[request.product] ?? 0;
  return {
    hcp: hcp.name,
    npi: hcp.npi,
    product: request.product,
    talking_points: talkingPoints,
    // Rep-only context is for the rep's eyes, never said to the HCP, so it is
    // not a promotional claim. It still never includes patient-level data.
    rep_context: [
      `Last call ${hcp.last_call_date}: ${hcp.last_call_topic}.`,
      `${request.product} TRx, last 13 weeks: ${now} (prior 13 weeks: ${before}).`,
    ],
  };
}

export function createPrecallPlanner({ checkerUrl, ...options }) {
  async function handle({ task }) {
    // A task can span several messages (see INPUT_REQUIRED below), so merge
    // the structured data from every message the rep has sent on this task.
    const request = Object.assign({}, ...task.history.filter((m) => m.role === Role.USER).map(dataOf).filter(Boolean));
    const hcp = hcps.find((h) => h.npi === request.hcp_npi);
    if (!hcp) return { state: TaskState.REJECTED, reply: `No HCP ${request.hcp_npi} in your territory data.` };
    if (!products[request.product]) {
      // Interrupted state: pause and ask the rep. The rep answers by sending
      // a new message with the same taskId, and this handler runs again.
      return { state: TaskState.INPUT_REQUIRED, reply: `Which product will you discuss with ${hcp.name}? (${Object.keys(products).join(" or ")})` };
    }
    const draft = draftPlan(hcp, request);

    // Ask the checker over A2A: discover its card, confirm the skill, send.
    let review;
    try {
      const { card, endpoint } = await discoverAgent(checkerUrl);
      if (!hasSkill(card, CHECKER_SKILL_ID)) throw new Error(`${card.name} does not offer ${CHECKER_SKILL_ID}`);
      const ask = newMessage(Role.USER, [
        textPart(`Review ${draft.talking_points.length} talking points for ${draft.product}.`),
        dataPart({ product: draft.product, hcp_specialty: hcp.specialty, talking_points: draft.talking_points.map((p) => p.text) }),
      ]);
      review = await sendMessage(endpoint, ask);
    } catch (err) {
      return { state: TaskState.FAILED, reply: `Compliance check unavailable (${err.message}). No plan without a check.` };
    }
    if (review.status.state !== TaskState.COMPLETED) {
      return { state: TaskState.FAILED, reply: `Compliance check ended ${review.status.state}. No plan without a check.` };
    }
    const verdict = review.artifacts.find((a) => a.artifactId === "compliance-verdict").parts[0].data;
    const audit = { checker_task_id: review.id, verdict: verdict.verdict };

    if (verdict.verdict === "BLOCK") {
      // The refusal. The rep gets the reasons, not the unsafe draft.
      const findings = verdict.findings.map((f) => ({ ...f, text: draft.talking_points[f.point_index].text }));
      const reasons = findings.map((f) => `point ${f.point_index + 1} ${f.rule_id} ("${f.matched}")`).join("; ");
      return { state: TaskState.REJECTED, reply: `I will not prepare this plan. Compliance blocked: ${reasons}.`, replyData: { ...audit, findings } };
    }
    return {
      state: TaskState.COMPLETED,
      reply: `Plan ready for ${hcp.name}: ${draft.talking_points.length} checked talking points.`,
      artifacts: [{ artifactId: "precall-plan", name: "Pre-call plan", parts: [dataPart({ ...draft, compliance: audit })] }],
    };
  }
  return createA2AServer({ buildCard: plannerCard, handle, ...options });
}
