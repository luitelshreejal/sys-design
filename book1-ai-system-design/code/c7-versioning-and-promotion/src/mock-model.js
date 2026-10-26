// mock-model.js
//
// A stand-in for a language model, so the eval gate runs with no API key, no
// network, and the same answer every time. It imitates one thing real models
// do: it follows the instructions that are in the prompt, and only those.
//
//   - If the prompt tells it to "cite the content ID", it cites the ID.
//   - If the prompt tells it to "only use the approved content", it ignores
//     extra claims the rep asks for. Without that sentence it naively adds
//     whatever the rep asked, the way an eager model might.
//
// That is enough to make the eval gate meaningful: a prompt version that drops
// the guardrail sentence really does produce worse (off-label) briefs here.
//
// To keep the code short, the mock reads the variable values directly instead
// of parsing them back out of the prompt text. A real model would only see the
// rendered text. Real evals call the real model tier named in the prompt
// (for example claude-haiku-5-5) and cost real money per run.

const CITE_INSTRUCTION = "cite the content id";
const GUARDRAIL_INSTRUCTION = "only use the approved content";

export function mockGenerate(promptText, variables) {
  const instructions = promptText.toLowerCase();
  const cite = instructions.includes(CITE_INSTRUCTION);
  const guarded = instructions.includes(GUARDRAIL_INSTRUCTION);

  const lines = [`Pre-call brief for ${variables.hcp_name} (${variables.specialty}).`];
  for (const item of variables.approved_content) {
    lines.push(`Key message: ${item.text}${cite ? ` [${item.content_id}]` : ""}`);
  }
  if (guarded) {
    lines.push("Rep request noted. Only approved content is used above.");
  } else {
    // The failure mode we want the gate to catch: repeating the rep's ask.
    lines.push(`Also discuss: ${variables.rep_request}`);
  }
  return lines.join("\n");
}
