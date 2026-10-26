// compliance-checker.js
//
// The compliance checker agent. It reviews draft talking points for a product
// and returns a verdict: PASS, or BLOCK with findings that say which point
// broke which rule. It is an A2A server, so any agent that can read its card
// can use it, not just our planner.
//
// The review itself is deliberately simple keyword rules from
// data/label-library.json. That is enough to show the protocol. A real
// promotional review checks claims against the MLR-approved claims library
// and the label, may use a model to help, and keeps humans (Medical, Legal,
// Regulatory) in charge of anything new. Rules here are a safety net only.

import { readFileSync } from "node:fs";
import { createA2AServer } from "./a2a-server.js";
import { TaskState, dataOf } from "./a2a.js";

const library = JSON.parse(readFileSync(new URL("../data/label-library.json", import.meta.url), "utf8"));

export const CHECKER_SKILL_ID = "promotional-claim-review";

// The agent card: the checker's public description. Field names follow the
// A2A 1.0 AgentCard object. Required fields: name, description,
// supportedInterfaces, version, capabilities, defaultInputModes,
// defaultOutputModes, skills.
export function checkerCard(endpointUrl) {
  return {
    name: "Compliance Checker",
    description: "Reviews draft HCP talking points against the approved label and claims library. Returns PASS or BLOCK with findings.",
    supportedInterfaces: [{ url: endpointUrl, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    provider: { organization: "Example Pharma Commercial Compliance (invented)", url: "https://compliance.example" },
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: CHECKER_SKILL_ID,
        name: "Promotional claim review",
        description: "Flags off-label populations, unapproved indications, absolute claims, and unsupported comparative claims.",
        tags: ["compliance", "mlr", "off-label"],
        examples: ['{"product":"Zentivra","talking_points":["..."]}'],
      },
    ],
  };
}

// Check every talking point against every rule that applies to the product.
export function reviewTalkingPoints(product, talkingPoints) {
  const label = library.products[product];
  const rules = [...library.rules];
  if (label.unapproved_indication_pattern) {
    rules.push({
      rule_id: "UNAPPROVED_INDICATION",
      description: `Mentions a use outside the approved indication: ${label.approved_indication}`,
      pattern: label.unapproved_indication_pattern,
    });
  }
  const findings = [];
  talkingPoints.forEach((point, index) => {
    for (const rule of rules) {
      const match = point.match(new RegExp(rule.pattern, "i"));
      if (match) findings.push({ point_index: index, rule_id: rule.rule_id, matched: match[0], why: rule.description });
    }
  });
  return { verdict: findings.length ? "BLOCK" : "PASS", findings };
}

// The A2A handler. Returns the next task state plus a reply.
export async function handleReview({ message }) {
  const request = dataOf(message);
  if (!request?.product || !Array.isArray(request.talking_points)) {
    return { state: TaskState.REJECTED, reply: "I only review JSON with a product and a talking_points list." };
  }
  if (!library.products[request.product]) {
    // Out of scope: we have no approved label for this product, so we will
    // not pretend to review it. REJECTED means "the agent chose not to do it".
    return { state: TaskState.REJECTED, reply: `No approved label on file for ${request.product}; cannot review.` };
  }
  const result = reviewTalkingPoints(request.product, request.talking_points);
  return {
    // COMPLETED means the review finished. The verdict inside may still be
    // BLOCK. A finished review that says "no" is still a finished review.
    state: TaskState.COMPLETED,
    reply: result.verdict === "PASS" ? "PASS: no issues found." : `BLOCK: ${result.findings.length} finding(s).`,
    artifacts: [{ artifactId: "compliance-verdict", name: "Compliance verdict", parts: [{ data: result, mediaType: "application/json" }] }],
  };
}

export function createComplianceChecker(options = {}) {
  return createA2AServer({ buildCard: checkerCard, handle: handleReview, ...options });
}
