// a2a-client.js
//
// The client side of A2A: how one agent finds another and talks to it.
//
//   discoverAgent(baseUrl)  fetches the agent card from the well-known path and
//                           picks the endpoint that speaks JSON-RPC, version 1.0.
//   sendMessage(...)        calls the SendMessage method and returns the Task.
//   getTask(...)            calls GetTask to look a task up again later.
//
// Uses the fetch function built into Node 18 and later, so there is nothing
// to install. An optional onWire hook lets the demo print the raw JSON.

import { AGENT_CARD_PATH, PROTOCOL_VERSION, VERSION_HEADER, METHODS, A2AError } from "./a2a.js";

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

let nextId = 1;

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

export const getTask = (endpoint, id, historyLength, options) =>
  callA2A(endpoint, METHODS.GET_TASK, historyLength === undefined ? { id } : { id, historyLength }, options);
