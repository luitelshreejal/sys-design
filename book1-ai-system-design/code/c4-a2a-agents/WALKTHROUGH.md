## Example C4: Two Agents Talking over A2A

### What this demonstrates

Two agents, owned by different teams, cooperate without sharing code. A **pre-call planner** (owned by Field Force AI) drafts talking points for a rep's next visit. A **compliance checker** (owned by Commercial Compliance) reviews those talking points against the approved label. They talk over **A2A** (Agent2Agent), an open protocol for agent-to-agent calls, version 1.0.

The example shows four ideas from the book:

- **Discovery through an agent card.** Each agent publishes a JSON description of itself at a fixed, well-known address. This is the agent equivalent of a data product's catalog entry (see Chapter 18 (Enterprise Agent Infrastructure)).
- **Tasks with states.** Every request becomes a task with an ID and a state, so a caller can tell "finished", "refused", "failed", and "waiting for you" apart, and an auditor can look the task up later (see Chapter 10 (Agents, Tools, and Orchestration)).
- **A guardrail implemented as a separate agent.** The checker can say no, and the planner obeys. When the checker cannot be reached, the planner fails closed (see Chapter 12 (Evaluation, Safety, and AI Governance)).
- **Multi-agent design with a reason.** The split exists because two teams own two different responsibilities, and Compliance must be able to change its rules without redeploying the planner. Chapter 10 warns against splitting agents for no reason; this is the kind of reason that justifies it.

The protocol code is a small hand-rolled subset of A2A 1.0, kept short so you can read every field on the wire. A test runs the official A2A JavaScript SDK (`@a2a-js/sdk` 1.3.0) against it to check that the subset matches the specification.

### How to run

You need Node.js 20 or later. No API key is needed.

```bash
cd book1-ai-system-design/code/c4-a2a-agents
npm install
npm test        # 17 tests, including the official-SDK interop test
npm run demo    # starts both agents on local ports and plays the rep's app
```

The demo runs four scenarios: an on-label plan (completed), a plan containing an off-label claim (refused), a request missing the product (the planner asks, the rep answers, the same task completes), and an audit lookup of the refused task.

### Walkthrough

**1. The agent card.** This is the checker's public description. The required fields come straight from the A2A 1.0 `AgentCard` object. `supportedInterfaces` tells a caller where to send calls and in which binding (JSON-RPC here). `skills` says what the agent can do. Think of a skill as a line in a service catalog: the planner checks for the `promotional-claim-review` skill before it trusts this agent with a review.

From `src/compliance-checker.js` (lines 20 to 46):

```js
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
```

**2. Discovery.** The caller fetches the card from `/.well-known/agent-card.json` and picks an interface it understands. If the card offers only bindings or versions the caller cannot speak, the caller stops here, before sending any data.

From `src/a2a-client.js` (lines 15 to 30):

```js
export async function discoverAgent(baseUrl) {
  const res = await fetch(new URL(AGENT_CARD_PATH, baseUrl));
  if (!res.ok) throw new Error(`no agent card at ${baseUrl}${AGENT_CARD_PATH} (HTTP ${res.status})`);
  const card = await res.json();
  // A card can list several interfaces (JSON-RPC, gRPC, HTTP+JSON). We only
  // speak JSON-RPC 1.0, so we pick that one or give up.
  const iface = card.supportedInterfaces?.find(
    (i) => i.protocolBinding === "JSONRPC" && i.protocolVersion === PROTOCOL_VERSION,
  );
  if (!iface) throw new Error(`${card.name} has no JSON-RPC ${PROTOCOL_VERSION} interface`);
  return { card, endpoint: iface.url };
}

// True if the card advertises a skill with this id. Skills are how an agent
// says what it can do, so a caller can check before sending work.
export const hasSkill = (card, skillId) => (card.skills ?? []).some((s) => s.id === skillId);
```

**3. One JSON-RPC call.** JSON-RPC 2.0 is a simple convention: POST a JSON body with `method` and `params`, and get back either `result` or `error`. A2A adds one rule here: every call carries the `A2A-Version` header, so an agent can tell which version of the protocol the caller speaks.

From `src/a2a-client.js` (lines 34 to 55):

```js
// One JSON-RPC call. JSON-RPC errors come back as A2AError with the code.
export async function callA2A(endpoint, method, params, { onWire } = {}) {
  const request = { jsonrpc: "2.0", id: nextId++, method, params };
  onWire?.("request", request);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", [VERSION_HEADER]: PROTOCOL_VERSION },
    body: JSON.stringify(request),
  });
  const response = await res.json();
  onWire?.("response", response);
  if (response.error) throw new A2AError(response.error.code, response.error.message, response.error.data);
  return response.result;
}

export async function sendMessage(endpoint, message, options) {
  const result = await callA2A(endpoint, METHODS.SEND_MESSAGE, { message }, options);
  // The result holds either a task or a direct message. Our agents always
  // create tasks, because tasks have states we can inspect and audit.
  if (!result.task) throw new Error("expected a task in the SendMessage result");
  return result.task;
}
```

**4. Task states.** These are the exact strings A2A 1.0 puts on the wire. The important split is between terminal states (the task is over and can never change) and interrupted states (the task is paused, waiting for the caller). Note that `REJECTED` and `FAILED` are different: rejected means the agent chose not to do the work, failed means it tried and something went wrong.

From `src/a2a.js` (lines 39 to 53):

```js
// Task states. A task is one unit of work an agent does for a client.
// TERMINAL states are final: the task can never change again.
// INTERRUPTED states pause the task until the client sends more input.
export const TaskState = {
  SUBMITTED: "TASK_STATE_SUBMITTED",
  WORKING: "TASK_STATE_WORKING",
  INPUT_REQUIRED: "TASK_STATE_INPUT_REQUIRED", // interrupted
  AUTH_REQUIRED: "TASK_STATE_AUTH_REQUIRED", // interrupted
  COMPLETED: "TASK_STATE_COMPLETED", // terminal
  FAILED: "TASK_STATE_FAILED", // terminal
  CANCELED: "TASK_STATE_CANCELED", // terminal
  REJECTED: "TASK_STATE_REJECTED", // terminal: the agent decided not to do it
};
const TERMINAL = new Set([TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELED, TaskState.REJECTED]);
export const isTerminal = (state) => TERMINAL.has(state);
```

**5. Handling SendMessage on the server.** A new message creates a task in `SUBMITTED`, then moves it to `WORKING` and hands it to the agent's own logic (`handle`). A message that carries a `taskId` continues an existing task, which is how a rep answers an `INPUT_REQUIRED` question. A message sent to a task that has already finished is refused, as the specification requires. If the agent's logic throws, the task ends `FAILED`; the server itself keeps running.

From `src/a2a-server.js` (lines 38 to 74):

```js
  async function sendMessage(params) {
    const message = params?.message;
    if (!message?.messageId || !message.role || !message.parts?.length) {
      throw new A2AError(ErrorCode.INVALID_PARAMS, "message needs messageId, role, and at least one part");
    }
    let task;
    if (message.taskId) {
      // Continuing an existing task (for example after INPUT_REQUIRED).
      task = tasks.get(message.taskId);
      if (!task) throw taskNotFound(message.taskId);
      if (isTerminal(task.status.state)) {
        // The spec says a task in a terminal state cannot accept new messages.
        throw new A2AError(ErrorCode.UNSUPPORTED_OPERATION, `task is ${task.status.state} and cannot accept new messages`);
      }
      task.history.push(message);
    } else {
      task = { id: randomUUID(), contextId: message.contextId ?? randomUUID(), artifacts: [], history: [message] };
      tasks.set(task.id, task);
      setState(task, TaskState.SUBMITTED);
    }
    setState(task, TaskState.WORKING);
    try {
      // The agent decides the outcome. It returns the next state, a reply for
      // the status message, and optionally structured data and artifacts.
      const outcome = await handle({ message, task });
      task.artifacts.push(...(outcome.artifacts ?? []));
      const parts = [textPart(outcome.reply)];
      if (outcome.replyData) parts.push(dataPart(outcome.replyData));
      const reply = newMessage(Role.AGENT, parts, { taskId: task.id, contextId: task.contextId });
      task.history.push(reply);
      setState(task, outcome.state, reply);
    } catch (err) {
      // An unexpected error inside the agent fails the task, not the server.
      const reply = newMessage(Role.AGENT, [textPart(`Agent error: ${err.message}`)], { taskId: task.id, contextId: task.contextId });
      setState(task, TaskState.FAILED, reply);
    }
    // A2A 1.0: the SendMessage result wraps either a "task" or a "message".
```

**6. Checking the version and the method.** Before any work happens, the server checks that the request is well-formed JSON-RPC, that the caller speaks version 1.0 (no header means the caller speaks 0.3), and that the method exists. Each failure has its own numeric code, so a calling program can react without parsing English error text.

From `src/a2a-server.js` (lines 101 to 127):

```js
  // One JSON-RPC request in, one JSON-RPC response out.
  async function dispatch(rpc, versionHeader) {
    const id = rpc?.id ?? null;
    try {
      if (rpc?.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
        throw new A2AError(ErrorCode.INVALID_REQUEST, "not a JSON-RPC 2.0 request");
      }
      // A missing header means the client speaks 0.3, which we do not support.
      const version = versionHeader ?? "0.3";
      if (version !== PROTOCOL_VERSION) {
        throw new A2AError(ErrorCode.VERSION_NOT_SUPPORTED, `A2A version ${version} not supported, use ${PROTOCOL_VERSION}`);
      }
      const fn = handlers[rpc.method];
      if (!fn) {
        if (knownButUnsupported.has(rpc.method)) {
          throw new A2AError(ErrorCode.UNSUPPORTED_OPERATION, `${rpc.method} is not supported by this agent`);
        }
        throw new A2AError(ErrorCode.METHOD_NOT_FOUND, `method ${rpc.method} not found`);
      }
      return { jsonrpc: "2.0", id, result: await fn(rpc.params) };
    } catch (err) {
      const code = err instanceof A2AError ? err.code : ErrorCode.INTERNAL_ERROR;
      const error = { code, message: err.message };
      if (err.data) error.data = err.data;
      return { jsonrpc: "2.0", id, error };
    }
  }
```

**7. The review.** The checker turns the request into one of three outcomes. Malformed input or an unknown product gets `REJECTED`: the agent declines work it is not set up to do. Otherwise the review runs and the task is `COMPLETED`, with the verdict (PASS or BLOCK) in an artifact. A finished review that says "no" still counts as a finished review, so the state is `COMPLETED` even when the verdict is BLOCK.

From `src/compliance-checker.js` (lines 69 to 88):

```js
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
```

**8. The planner refuses.** This is the heart of the example. The planner sends its draft to the checker and reads the verdict. On BLOCK it ends its own task `REJECTED` and returns the reasons, never the draft. If the checker is unreachable, does not offer the expected skill, or does not finish, the planner ends `FAILED`. There is no path that returns a plan without a PASS. The checker's task ID is copied into the plan as an audit link.

From `src/precall-planner.js` (lines 84 to 113):

```js
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
```

### What to notice

- **The card is a contract.** The planner never hard-codes the checker's endpoint path. It reads the card, so Compliance can move the endpoint or add a gRPC interface without telling the planner team. Removing the `promotional-claim-review` skill, on the other hand, breaks the planner on purpose. Treat a card change like a data contract change (see Example C7 for versioning).
- **States carry meaning that a plain HTTP 200 cannot.** Every response in the demo is HTTP 200, yet the outcomes differ: completed, rejected, failed, input required. A dashboard that counts only HTTP errors would miss every refusal. Monitor task states.
- **Refusal and failure are different signals.** `REJECTED` (with findings) means the guardrail worked and the rep should change the request. `FAILED` means the guardrail was unavailable and someone should be paged. Mixing them up hides outages or creates false alarms.
- **Two task IDs per request.** The planner's task and the checker's task are separate, linked by `checker_task_id`. An auditor asking "who approved this plan?" follows that link. Chapter 19 (Operating AI Platforms) shows how tracing ties such hops together automatically.
- **The rules sit with the team that owns them.** The checker's rules live in `data/label-library.json`, outside the planner. Compliance can tighten them without a planner release.

### What production would add

- **Authentication and authorization.** The card would declare `securitySchemes`, and each call would carry a short-lived, downscoped token that says "the planner, acting for rep Jordan Lee" (see Example C3 and Chapter 6 (Security, Privacy, and Compliance by Design)). Calls would pass through a gateway with allow-lists and audit logs (see Example C2).
- **Signed agent cards.** A2A 1.0 supports card signatures, so a caller can verify that a card really came from Compliance and was not swapped by an attacker.
- **A durable task store and retention policy.** Tasks would live in a database with retention that matches promotional-review record keeping, not in process memory.
- **Streaming and push notifications** for long reviews, using `SendStreamingMessage` and push configuration, instead of making the caller wait.
- **A real review service.** Claim matching against the MLR-approved claims library, a model as a second reader, and a human MLR reviewer for anything new. Keyword rules would remain only as a cheap first filter.
- **The official SDK.** A team shipping this would build on `@a2a-js/sdk` (or another official SDK) rather than maintaining its own protocol code, and would keep an interop test like `test/sdk-interop.test.js` in CI.
