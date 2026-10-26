// a2a.js
//
// The vocabulary of the A2A (Agent2Agent) protocol, version 1.0, in one place.
// A2A is an open protocol that lets two agents, possibly built by different
// teams or vendors, find each other and hand work back and forth. Every name
// and number below was checked against the A2A 1.0 specification
// (a2a-protocol.org/latest/specification, checked 2026-10-23).
//
// This example hand-rolls a small subset of A2A so you can see every byte on
// the wire. An official JavaScript SDK exists (@a2a-js/sdk). We use it only in
// test/sdk-interop.test.js, to prove our hand-rolled server speaks real A2A.
// A production team would normally build on the SDK instead of this file.

import { randomUUID } from "node:crypto";

// Where an agent publishes its "agent card" (its public description: name,
// skills, endpoint URL). This is a "well-known URI", a fixed path that any
// client can fetch without being told where to look first.
export const AGENT_CARD_PATH = "/.well-known/agent-card.json";

// The protocol version we speak. Clients send it in the A2A-Version HTTP
// header on every call. The spec says a missing header means "0.3", an older
// version we do not support.
export const PROTOCOL_VERSION = "1.0";
export const VERSION_HEADER = "A2A-Version";

// JSON-RPC method names. A2A 1.0 uses PascalCase names. (Older 0.x versions
// used names like "message/send"; you will still see those in old blog posts.)
export const METHODS = {
  SEND_MESSAGE: "SendMessage",
  GET_TASK: "GetTask",
  CANCEL_TASK: "CancelTask",
  // Part of A2A, but not implemented in this small example:
  SEND_STREAMING_MESSAGE: "SendStreamingMessage",
  LIST_TASKS: "ListTasks",
  SUBSCRIBE_TO_TASK: "SubscribeToTask",
};

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

export const Role = { USER: "ROLE_USER", AGENT: "ROLE_AGENT" };

// JSON-RPC error codes. The first five are standard JSON-RPC 2.0 codes. The
// rest are A2A-specific codes from section 5.4 of the spec.
export const ErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  UNSUPPORTED_OPERATION: -32004,
  VERSION_NOT_SUPPORTED: -32009,
};

// A Part is one piece of a message. In A2A 1.0 a part holds exactly one of
// "text", "data" (any JSON), "url", or "raw" (bytes). There is no "kind" field
// any more; the field name itself says what the part is.
export const textPart = (text) => ({ text });
export const dataPart = (data) => ({ data, mediaType: "application/json" });

// Build a message. messageId is created by whoever writes the message.
// taskId and contextId are only set when continuing an existing task.
export function newMessage(role, parts, { taskId, contextId } = {}) {
  const message = { messageId: randomUUID(), role, parts };
  if (taskId) message.taskId = taskId;
  if (contextId) message.contextId = contextId;
  return message;
}

// Helpers to read parts back out of a message.
export const textOf = (message) => (message?.parts ?? []).filter((p) => "text" in p).map((p) => p.text).join("\n");
export const dataOf = (message) => (message?.parts ?? []).find((p) => "data" in p)?.data;

// An error that carries a JSON-RPC code, so the server can turn it into a
// proper JSON-RPC error response and the client can turn it back into this.
export class A2AError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}
