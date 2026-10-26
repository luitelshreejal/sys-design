// a2a-server.js
//
// A minimal A2A 1.0 server over plain HTTP, using only Node's built-in http
// module. It does three jobs that every A2A agent needs:
//
//   1. Publish the agent card at /.well-known/agent-card.json (discovery).
//   2. Accept JSON-RPC 2.0 calls (SendMessage, GetTask, CancelTask).
//   3. Keep track of tasks and move them through the A2A task states.
//
// The agent's actual "brain" is passed in as a function (handle). The server
// knows nothing about pharma. That separation is the point of a protocol: the
// planner and the checker below share this transport code but nothing else.
//
// Production would add: authentication declared in the card (securitySchemes),
// a durable task store (a database, not a Map in memory), streaming over
// Server-Sent Events, request size limits, and audit logging.

import http from "node:http";
import { randomUUID } from "node:crypto";
import {
  AGENT_CARD_PATH, PROTOCOL_VERSION, METHODS, TaskState, Role, ErrorCode,
  A2AError, isTerminal, newMessage, textPart, dataPart,
} from "./a2a.js";

export function createA2AServer({ buildCard, handle, onTransition = () => {} }) {
  const tasks = new Map(); // taskId -> Task. In memory only: lost on restart.
  let card;

  // Move a task to a new state and remember when. Every change is reported
  // to onTransition so the demo can print the task's life story.
  function setState(task, state, statusMessage) {
    const from = task.status?.state ?? "(new)";
    task.status = { state, timestamp: new Date().toISOString() };
    if (statusMessage) task.status.message = statusMessage;
    onTransition({ agent: card.name, taskId: task.id, from, to: state });
  }

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
    return { task: view(task) };
  }

  function getTask(params) {
    const task = tasks.get(params?.id);
    if (!task) throw taskNotFound(params?.id);
    return view(task, params.historyLength);
  }

  function cancelTask(params) {
    const task = tasks.get(params?.id);
    if (!task) throw taskNotFound(params?.id);
    if (isTerminal(task.status.state)) {
      throw new A2AError(ErrorCode.TASK_NOT_CANCELABLE, `task is already ${task.status.state}`);
    }
    setState(task, TaskState.CANCELED);
    return view(task);
  }

  const handlers = {
    [METHODS.SEND_MESSAGE]: sendMessage,
    [METHODS.GET_TASK]: getTask,
    [METHODS.CANCEL_TASK]: cancelTask,
  };
  const knownButUnsupported = new Set([METHODS.SEND_STREAMING_MESSAGE, METHODS.LIST_TASKS, METHODS.SUBSCRIBE_TO_TASK]);

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

  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === AGENT_CARD_PATH) return send(200, card);
    if (req.method === "POST" && req.url === "/a2a/v1") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let rpc;
      try {
        rpc = JSON.parse(raw);
      } catch {
        return send(200, { jsonrpc: "2.0", id: null, error: { code: ErrorCode.PARSE_ERROR, message: "invalid JSON" } });
      }
      // Node lower-cases incoming header names.
      return send(200, await dispatch(rpc, req.headers["a2a-version"]));
    }
    send(404, { error: "not found" });
  });

  return {
    tasks,
    // Start listening. Port 0 means "pick any free port", handy for tests.
    async start(port = 0) {
      await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      card = buildCard(`${baseUrl}/a2a/v1`);
      return baseUrl;
    },
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

// The task as the client sees it. historyLength (optional) trims the history
// to the most recent N messages, as GetTask allows.
function view(task, historyLength) {
  const history = historyLength === undefined ? task.history : task.history.slice(Math.max(0, task.history.length - historyLength));
  return { id: task.id, contextId: task.contextId, status: task.status, artifacts: task.artifacts, history };
}

// Error details follow the spec's ErrorInfo shape so machines can read them.
function taskNotFound(taskId) {
  return new A2AError(ErrorCode.TASK_NOT_FOUND, "Task not found", [
    { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "TASK_NOT_FOUND", domain: "a2a-protocol.org", metadata: { taskId } },
  ]);
}
