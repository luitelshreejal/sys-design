// model-mock.js
//
// A scripted stand-in for Claude, so the example runs with no API key and
// gives the same result every time. It returns responses in the same shape
// as the Anthropic Messages API (content blocks, stop_reason, usage), so the
// agent loop cannot tell it apart from the real model.
//
// The script for "prepare me for Dr. <name>":
//   call 1: ask for get_hcp_profile
//   call 2: ask for get_recent_interactions AND get_approved_content at once
//           (two tool calls in one response, as real models often do)
//   call 3: write the brief from the tool results
//
// Two misbehaving modes exist for testing the budgets:
//   loop: true          never finishes, keeps asking for more tools
//   tokensPerCall: N    reports N input tokens on every call

const estimate = (value) => Math.ceil(JSON.stringify(value).length / 4);

export function createMockModel({ id = "claude-haiku-5-5", loop = false, tokensPerCall } = {}) {
  let calls = 0;

  function respond(content, stop_reason, messages) {
    calls += 1;
    return {
      id: `msg_mock_${String(calls).padStart(3, "0")}`,
      type: "message",
      role: "assistant",
      model: id,
      content,
      stop_reason,
      usage: { input_tokens: tokensPerCall ?? estimate(messages), output_tokens: estimate(content) },
    };
  }
  const toolUse = (name, input) => ({ type: "tool_use", id: `toolu_mock_${calls + 1}_${name}`, name, input });

  // Read back the results of earlier tool calls from the conversation.
  function results(messages) {
    const byName = {};
    const uses = new Map();
    for (const m of messages) {
      if (!Array.isArray(m.content)) continue;
      for (const block of m.content) {
        if (block.type === "tool_use") uses.set(block.id, block.name);
        if (block.type === "tool_result" && !block.is_error) byName[uses.get(block.tool_use_id)] = JSON.parse(block.content);
      }
    }
    return byName;
  }

  return {
    id,
    get calls() {
      return calls;
    },
    async create({ messages }) {
      const done = results(messages);
      const lastName = messages[0].content.match(/Dr\.?\s+([A-Z][a-z]+)/)?.[1] ?? "Patel";
      if (!done.get_hcp_profile) {
        return respond([toolUse("get_hcp_profile", { last_name: lastName })], "tool_use", messages);
      }
      const hcp = done.get_hcp_profile;
      if (loop || !done.get_recent_interactions) {
        return respond([
          { type: "text", text: "Checking recent calls and approved content." },
          toolUse("get_recent_interactions", { npi: hcp.npi, limit: 3 }),
          toolUse("get_approved_content", { brand: "Zentivra", specialty: hcp.specialty }),
        ], "tool_use", messages);
      }
      const [last] = done.get_recent_interactions;
      const content = done.get_approved_content;
      const brief = [
        `Pre-call brief: Dr. ${hcp.first_name} ${hcp.last_name}, ${hcp.specialty}, ${hcp.hco_name}.`,
        `Segment: ${hcp.segment}. Prefers: ${hcp.preferred_channel}. Office: ${hcp.office_phone}.`,
        `Last call ${last.date}: ${last.notes}`,
        `Lead with ${content.find((c) => c.title.startsWith("Dosing"))?.content_id ?? content[0].content_id} (dosing and titration) to answer that question.`,
        `Approved content you may use: ${content.map((c) => `${c.content_id} (${c.mlr_approval_id})`).join(", ")}.`,
      ].join("\n");
      return respond([{ type: "text", text: brief }], "end_turn", messages);
    },
  };
}
