// agent.js
//
// The agent loop, with budgets and tracing.
//
// An agent loop is simple: send the conversation to the model; if the model
// asks for tools, run them, add the results to the conversation, and go
// again; stop when the model gives a final answer. Two things make it safe
// to run in production, and this file adds both:
//
//   BUDGETS  A step budget (maximum model calls) and a token budget (maximum
//            tokens across all calls). Without them, a confused model can
//            loop forever and spend without limit.
//   TRACING  One span for the whole request, one per model call, and one per
//            tool call, named and labelled with the OpenTelemetry GenAI
//            semantic conventions (status: Development, so names can still
//            change). Attributes starting "app." are our own additions,
//            because the conventions have no budget attributes.

import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { toolDefinitions, runTool, describeTool } from "./tools.js";
import { redactedJson } from "./redact.js";

export const AGENT_NAME = "precall_prep_agent";
const SYSTEM = "You help a pharmaceutical field rep prepare for HCP visits. Use the tools to look up the HCP, recent interactions, and approved content. Only suggest MLR-approved content returned by get_approved_content. Reply with a short pre-call brief.";

export async function runAgent({ question, model, tracer, maxSteps = 6, maxTotalTokens = 20000, maxTokensPerCall = 1024, conversationId = "conv-demo-001" }) {
  const rootAttributes = {
    "gen_ai.operation.name": "invoke_agent",
    "gen_ai.agent.name": AGENT_NAME,
    "gen_ai.provider.name": "anthropic",
    "gen_ai.conversation.id": conversationId,
    "app.budget.max_steps": maxSteps,
    "app.budget.max_total_tokens": maxTotalTokens,
  };
  return tracer.startActiveSpan(`invoke_agent ${AGENT_NAME}`, { kind: SpanKind.INTERNAL, attributes: rootAttributes }, async (root) => {
    const messages = [{ role: "user", content: question }];
    const usage = { input: 0, output: 0 };
    let steps = 0;

    // Every way out of the loop goes through finish(), so the root span
    // always records the outcome, the totals, and its status.
    const finish = (status, answer, errorType) => {
      root.setAttributes({ "app.agent.status": status, "app.agent.steps": steps, "gen_ai.usage.input_tokens": usage.input, "gen_ai.usage.output_tokens": usage.output });
      if (errorType) {
        root.setAttribute("error.type", errorType);
        root.setStatus({ code: SpanStatusCode.ERROR, message: status });
      }
      root.end();
      return { status, answer, steps, usage };
    };

    try {
      while (true) {
        if (steps >= maxSteps) return finish("budget_exceeded", null, "step_budget_exceeded");
        steps += 1;
        const response = await tracedModelCall(tracer, model, { system: SYSTEM, messages, tools: toolDefinitions, max_tokens: maxTokensPerCall }, conversationId);
        usage.input += response.usage.input_tokens;
        usage.output += response.usage.output_tokens;
        messages.push({ role: "assistant", content: response.content });

        if (usage.input + usage.output > maxTotalTokens) return finish("budget_exceeded", null, "token_budget_exceeded");
        if (response.stop_reason === "refusal") return finish("refused", null, "refusal");
        const toolUses = response.content.filter((block) => block.type === "tool_use");
        if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
          const answer = response.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
          return finish("completed", answer);
        }
        // Run every requested tool, then send ALL results back in ONE user
        // message. Splitting them across messages confuses the model.
        const results = [];
        for (const toolUse of toolUses) results.push(await tracedToolCall(tracer, toolUse, conversationId));
        messages.push({ role: "user", content: results });
      }
    } catch (err) {
      root.recordException(err);
      return finish("failed", null, err.name ?? "Error");
    }
  });
}

// One model call = one span named "chat <model>" (kind CLIENT, because it
// calls a remote service). Request attributes are set when the span starts,
// response attributes when the answer arrives. The model's output is stored
// only after redaction (the conventions mark message content as Opt-In).
async function tracedModelCall(tracer, model, request, conversationId) {
  const attributes = {
    "gen_ai.operation.name": "chat",
    "gen_ai.provider.name": "anthropic",
    "gen_ai.request.model": model.id,
    "gen_ai.request.max_tokens": request.max_tokens,
    "gen_ai.conversation.id": conversationId,
  };
  return tracer.startActiveSpan(`chat ${model.id}`, { kind: SpanKind.CLIENT, attributes }, async (span) => {
    try {
      const response = await model.create(request);
      span.setAttributes({
        "gen_ai.response.id": response.id,
        "gen_ai.response.model": response.model,
        "gen_ai.response.finish_reasons": [response.stop_reason],
        "gen_ai.usage.input_tokens": response.usage.input_tokens,
        "gen_ai.usage.output_tokens": response.usage.output_tokens,
        "gen_ai.output.messages": redactedJson([{ role: "assistant", content: response.content }]),
      });
      return response;
    } catch (err) {
      span.setAttribute("error.type", err.constructor?.name ?? "Error");
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

// One tool call = one span named "execute_tool <tool>" (kind INTERNAL, because
// it runs in our own process). Arguments and result are redacted first. A tool
// failure does not crash the agent: it becomes an is_error tool result, so the
// model can see what went wrong and try something else.
async function tracedToolCall(tracer, toolUse, conversationId) {
  const attributes = {
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": toolUse.name,
    "gen_ai.tool.call.id": toolUse.id,
    "gen_ai.tool.type": "function",
    "gen_ai.tool.description": describeTool(toolUse.name) ?? "",
    "gen_ai.tool.call.arguments": redactedJson(toolUse.input),
    "gen_ai.agent.name": AGENT_NAME,
    "gen_ai.conversation.id": conversationId,
  };
  return tracer.startActiveSpan(`execute_tool ${toolUse.name}`, { kind: SpanKind.INTERNAL, attributes }, async (span) => {
    try {
      const result = await runTool(toolUse.name, toolUse.input);
      span.setAttribute("gen_ai.tool.call.result", redactedJson(result));
      // The MODEL gets the full, unredacted result: the rep needs the phone number.
      return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(result) };
    } catch (err) {
      span.setAttribute("error.type", "tool_error");
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      return { type: "tool_result", tool_use_id: toolUse.id, content: err.message, is_error: true };
    } finally {
      span.end();
    }
  });
}
