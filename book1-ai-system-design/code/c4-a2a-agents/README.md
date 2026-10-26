# C4: Two agents talking over A2A (pre-call planner and compliance checker)

Book 1, Appendix C, Example C4. All data is invented. Zentivra and Lumotrex are fictional brands, and NPIs start with 9 so they cannot match a real clinician.

## What it shows

- **Agent card discovery.** Each agent publishes a JSON "agent card" at `/.well-known/agent-card.json`. The card gives the agent's name, its skills, and the URL where it accepts calls. Callers read the card before sending work.
- **Sending a message.** Agents call each other with JSON-RPC 2.0 over HTTP, using the A2A 1.0 method `SendMessage`. They also use `GetTask` (look a task up later) and `CancelTask`.
- **Task states.** Every request becomes a task that moves through `TASK_STATE_SUBMITTED`, `TASK_STATE_WORKING`, and then a final or paused state: `COMPLETED`, `REJECTED`, `FAILED`, or `INPUT_REQUIRED`.
- **The planner refusing to proceed.** The rep's request is passed to the pre-call planner, which drafts talking points and sends them to the compliance checker. When the checker flags an off-label claim (here, teenage patients, while the label covers adults only), the planner refuses. The task ends `TASK_STATE_REJECTED` and no plan goes back to the rep.
- **Failing closed.** If the checker cannot be reached, the planner ends `TASK_STATE_FAILED`. It never skips the check.

```
rep app  --A2A-->  Pre-call Planner  --A2A-->  Compliance Checker
                   (drafts the plan)           (PASS or BLOCK)
```

## Hand-rolled protocol subset, checked against the official SDK

The A2A code here is a small subset written by hand (`src/a2a.js`, `src/a2a-server.js`, `src/a2a-client.js`), so that every field on the wire is visible in about 330 lines. It follows the **A2A 1.0.0** specification (a2a-protocol.org, checked 2026-10-23):

| Spec fact | Value used here |
|---|---|
| Agent card location | `/.well-known/agent-card.json` |
| JSON-RPC methods | `SendMessage`, `GetTask`, `CancelTask` (implemented); `SendStreamingMessage`, `ListTasks`, `SubscribeToTask` answer "unsupported operation" |
| Version header | `A2A-Version: 1.0` on every call; a missing header means 0.3, which gets error -32009 |
| Task states | `TASK_STATE_SUBMITTED`, `_WORKING`, `_INPUT_REQUIRED`, `_AUTH_REQUIRED`, `_COMPLETED`, `_FAILED`, `_CANCELED`, `_REJECTED` |
| Roles | `ROLE_USER`, `ROLE_AGENT` |
| Parts | exactly one of `text`, `data`, `url`, `raw`, with optional `mediaType`; no `kind` field in 1.0 |
| SendMessage result | `{ "task": {...} }` or `{ "message": {...} }` |
| Errors | -32001 task not found, -32002 not cancelable, -32004 unsupported operation, -32009 version not supported, plus the standard JSON-RPC codes |

An official JavaScript SDK exists: `@a2a-js/sdk` 1.3.0, which implements A2A 1.0. The example code does not depend on it. It is a dev dependency used only by `test/sdk-interop.test.js`, where the SDK's own client discovers our hand-rolled checker, sends it a message, and reads the task back. That test is how we know the subset is spec-faithful. A production team would normally build on the SDK rather than hand-roll the protocol.

## How to run

Requires Node.js 20 or later (tested on Node 26). No API key and no network access are needed beyond `npm install`.

```bash
cd book1-ai-system-design/code/c4-a2a-agents
npm install
npm test
npm run demo
```

This example has no real-model mode. The planner's drafting step is a deterministic stand-in for a model call (see "Limitations").

## Expected output

`npm test` runs 17 tests in three files and they should all pass:

```
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
```

`npm run demo` prints the following. Task IDs are random UUIDs, so the 8-character prefixes change on every run, and the port is hidden.

```
== Discovery: fetch the planner's agent card ==
  Pre-call Planner v1.0.0, skills: precall-plan
  endpoint: http://127.0.0.1:<port>/a2a/v1 (JSONRPC, A2A 1.0)

== Scenario 1: on-label plan for Dr. Patel ==
  wire request: {"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"<uuid>","role":"ROLE_USER","parts":[{"text":"Prepare me for Dr. Patel tomorrow."},{"data":{"hcp_npi":"9000000060","product":"Zentivra"},"mediaType":"application/json"}]}}}
    [Pre-call Planner] task f2034088: (new) -> TASK_STATE_SUBMITTED
    [Pre-call Planner] task f2034088: TASK_STATE_SUBMITTED -> TASK_STATE_WORKING
    [Compliance Checker] task b15366c9: (new) -> TASK_STATE_SUBMITTED
    [Compliance Checker] task b15366c9: TASK_STATE_SUBMITTED -> TASK_STATE_WORKING
    [Compliance Checker] task b15366c9: TASK_STATE_WORKING -> TASK_STATE_COMPLETED
    [Pre-call Planner] task f2034088: TASK_STATE_WORKING -> TASK_STATE_COMPLETED
  result: TASK_STATE_COMPLETED: Plan ready for Dr. Anita Patel: 2 checked talking points.
    1. [ZEN-CORE-001] In the pivotal trial, Zentivra reduced the risk of heart failure hospitalization versus placebo. See full Prescribing Information.
    2. [ZEN-DOSE-002] Zentivra is taken once daily. Titrate per the Prescribing Information based on tolerability and renal function.
    rep only: Last call 2026-09-24: Asked about titration in patients with reduced renal function.
    rep only: Zentivra TRx, last 13 weeks: 22 (prior 13 weeks: 15).
    compliance: PASS (checker task b15366c9)

== Scenario 2: the rep asks to add an off-label point ==
    [Pre-call Planner] task 49ab8d88: (new) -> TASK_STATE_SUBMITTED
    [Pre-call Planner] task 49ab8d88: TASK_STATE_SUBMITTED -> TASK_STATE_WORKING
    [Compliance Checker] task 818f4e24: (new) -> TASK_STATE_SUBMITTED
    [Compliance Checker] task 818f4e24: TASK_STATE_SUBMITTED -> TASK_STATE_WORKING
    [Compliance Checker] task 818f4e24: TASK_STATE_WORKING -> TASK_STATE_COMPLETED
    [Pre-call Planner] task 49ab8d88: TASK_STATE_WORKING -> TASK_STATE_REJECTED
  result: TASK_STATE_REJECTED: I will not prepare this plan. Compliance blocked: point 3 OFF_LABEL_POPULATION ("teenage").
  artifacts returned to the rep: 0

== Scenario 3: no product given, so the planner asks (INPUT_REQUIRED) ==
    [Pre-call Planner] task c924679b: (new) -> TASK_STATE_SUBMITTED
    [Pre-call Planner] task c924679b: TASK_STATE_SUBMITTED -> TASK_STATE_WORKING
    [Pre-call Planner] task c924679b: TASK_STATE_WORKING -> TASK_STATE_INPUT_REQUIRED
  result: TASK_STATE_INPUT_REQUIRED: Which product will you discuss with Dr. Anita Patel? (Zentivra or Lumotrex)
    [Pre-call Planner] task c924679b: TASK_STATE_INPUT_REQUIRED -> TASK_STATE_WORKING
    [Compliance Checker] task b3c4b91f: (new) -> TASK_STATE_SUBMITTED
    [Compliance Checker] task b3c4b91f: TASK_STATE_SUBMITTED -> TASK_STATE_WORKING
    [Compliance Checker] task b3c4b91f: TASK_STATE_WORKING -> TASK_STATE_COMPLETED
    [Pre-call Planner] task c924679b: TASK_STATE_WORKING -> TASK_STATE_COMPLETED
  same task c924679b after the rep answers: TASK_STATE_COMPLETED

== Scenario 4: audit. Look up the rejected task later with GetTask ==
  49ab8d88 is TASK_STATE_REJECTED; findings: ["OFF_LABEL_POPULATION"]
  sending to a finished task fails: error -32004 task is TASK_STATE_REJECTED and cannot accept new messages
```

## File map

| File | What it does |
|---|---|
| `src/a2a.js` | Protocol vocabulary: card path, method names, task states, roles, error codes, part and message helpers |
| `src/a2a-server.js` | Minimal A2A server: serves the card, dispatches JSON-RPC, keeps tasks in memory, moves them through states |
| `src/a2a-client.js` | Discovery (fetch the card, pick the JSON-RPC 1.0 interface) and JSON-RPC calls |
| `src/compliance-checker.js` | The checker agent: card plus keyword rules for off-label population, unapproved indication, absolute and comparative claims |
| `src/precall-planner.js` | The planner agent: drafts a plan, asks the checker, refuses on BLOCK, fails closed if the checker is unavailable |
| `src/demo.js` | Starts both agents on local ports and plays the rep's app |
| `data/label-library.json` | Invented label summaries, approved content, and review rules |
| `data/hcps.json` | Invented HCP slice the planner may read |
| `test/protocol.test.js` | Card fields, method names, task states, GetTask, error codes |
| `test/agents.test.js` | Planner and checker together: PASS, refusal, INPUT_REQUIRED, fail closed |
| `test/sdk-interop.test.js` | The official `@a2a-js/sdk` client against our checker |

## Limitations

- **Subset only.** No streaming (`SendStreamingMessage`), no push notifications, no `ListTasks`, no extended agent card, no gRPC or HTTP+JSON bindings. The card says `streaming: false` so callers know.
- **No authentication.** The cards declare no `securitySchemes`, and anyone on the machine can call the agents. In production, agent-to-agent calls carry a delegated, short-lived token (see Example C3) and pass through a gateway (see Example C2).
- **Tasks live in memory.** They vanish when the process stops. A real agent stores tasks in a database so audits can find them months later.
- **The checker is keyword rules.** It catches the obvious cases in the demo and nothing subtle. Real promotional review matches claims against the MLR-approved claims library, and humans make the final decision.
- **The drafting step is not a model.** It copies approved content and appends whatever the rep asked for, to imitate a model that follows a pushy instruction. Swapping in a real model call would not change the protocol code.
