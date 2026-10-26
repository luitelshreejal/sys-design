// prompt-diff.js
//
// Change classification for PROMPTS. A prompt is not a schema, so we cannot
// prove whether a wording change is "safe". We use simple, documented rules
// and let the eval gate (eval-gate.js) catch behaviour changes:
//
//   major  a new variable was added. Every caller must now supply it, or the
//          prompt cannot be filled in. That breaks callers, like a new
//          required tool input.
//   minor  the template text changed, a variable was removed, or the model
//          changed (for example claude-haiku-5-5 to claude-sonnet-5-5).
//          Callers still work, but the model's behaviour may change, which
//          is exactly what the eval gate is there to check.
//   patch  only the human description (metadata) changed. The model never
//          sees it.
//
// Many teams treat every template change as minor for this reason: you cannot
// tell from a diff whether "be concise" changes compliance behaviour.

import { highest } from "./semver.js";

export function classifyPromptChange(oldPrompt, newPrompt) {
  const changes = [];
  const before = oldPrompt.variables || [];
  const after = newPrompt.variables || [];

  for (const v of after.filter((x) => !before.includes(x))) {
    changes.push({ path: `variables.${v}`, kind: "variable_added", level: "major", detail: "callers must now supply this value" });
  }
  for (const v of before.filter((x) => !after.includes(x))) {
    changes.push({ path: `variables.${v}`, kind: "variable_removed", level: "minor", detail: "value no longer used" });
  }
  if (oldPrompt.template !== newPrompt.template) {
    changes.push({ path: "template", kind: "template_changed", level: "minor", detail: "instructions edited, behaviour may change" });
  }
  if (oldPrompt.model !== newPrompt.model) {
    changes.push({ path: "model", kind: "model_changed", level: "minor", detail: `${oldPrompt.model} -> ${newPrompt.model}` });
  }
  if ((oldPrompt.description || "") !== (newPrompt.description || "")) {
    changes.push({ path: "description", kind: "description_changed", level: "patch", detail: "metadata only" });
  }

  const level = changes.reduce((acc, c) => highest(acc, c.level), "none");
  return { level, changes };
}
