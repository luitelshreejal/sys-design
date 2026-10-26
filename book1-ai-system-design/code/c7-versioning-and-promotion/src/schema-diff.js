// schema-diff.js
//
// The breaking-change detector for TOOL definitions. A tool definition has a
// name, a description, and an input_schema: a JSON Schema that says which
// inputs the agent (the caller) must or may send. JSON Schema is a standard
// way to describe the shape of a JSON object: its fields, their types, which
// ones are required, and which values are allowed.
//
// The question we answer: "If an agent that was built against the OLD schema
// keeps calling the tool exactly as before, will the NEW tool accept it?"
//
//   major (breaking)  the old call may now be rejected or misread:
//                     removed field, type change, new required input,
//                     optional field becoming required, enum value removed
//   minor             new capability, old calls still fine:
//                     new optional field, enum value added, required field
//                     becoming optional
//   patch             wording only: description or title edits
//
// Anything we do not recognise (for example a new "pattern" or "maximum"
// constraint) is treated as BREAKING. A gate should fail safe: a human can
// look and decide, which is cheaper than an agent silently failing in the field.
//
// Note the direction. These rules are for INPUTS. For a tool's OUTPUT schema
// the rules flip (removing an output field breaks the reader, adding one does
// not). This example only versions inputs.

import { highest } from "./semver.js";

// Keywords this detector understands. Everything else falls into the
// "unrecognised, treat as breaking" rule.
const KNOWN = new Set(["type", "properties", "required", "enum", "items", "description", "title"]);

// Compare two schema nodes and push every difference into `changes`.
// `path` is a human-readable location such as "filters.channel".
function compareNode(oldNode, newNode, path, changes) {
  const add = (kind, level, detail) => changes.push({ path: path || "(root)", kind, level, detail });

  // 1. Type change, for example npi going from "string" to "integer".
  if (JSON.stringify(oldNode.type) !== JSON.stringify(newNode.type)) {
    add("type_changed", "major", `type ${JSON.stringify(oldNode.type)} -> ${JSON.stringify(newNode.type)}`);
    return; // Children of a different type are not comparable.
  }

  // 2. Enum (the list of allowed values). Removing a value narrows it, so a
  //    caller that sends the removed value now fails. Adding one widens it.
  if (oldNode.enum || newNode.enum) {
    const before = oldNode.enum || [];
    const after = newNode.enum || [];
    const removed = before.filter((v) => !after.includes(v));
    const added = after.filter((v) => !before.includes(v));
    if (!oldNode.enum) add("enum_added", "major", "field now restricted to a list of values");
    else if (!newNode.enum) add("enum_widened", "minor", "list of allowed values removed, any value accepted");
    else {
      if (removed.length) add("enum_narrowed", "major", `removed allowed value(s): ${removed.join(", ")}`);
      if (added.length) add("enum_widened", "minor", `added allowed value(s): ${added.join(", ")}`);
    }
  }

  // 3. Wording. Descriptions matter to an LLM (it reads them to decide how
  //    to call the tool), so we record them, but they do not break callers.
  if ((oldNode.description || "") !== (newNode.description || "")) add("description_changed", "patch", "description edited");
  if ((oldNode.title || "") !== (newNode.title || "")) add("title_changed", "patch", "title edited");

  // 4. Fields of an object, compared one by one, then recursed into.
  if (oldNode.properties || newNode.properties) {
    const oldProps = oldNode.properties || {};
    const newProps = newNode.properties || {};
    const oldReq = new Set(oldNode.required || []);
    const newReq = new Set(newNode.required || []);
    const child = (name) => (path ? `${path}.${name}` : name);

    for (const name of Object.keys(oldProps)) {
      if (!(name in newProps)) {
        changes.push({ path: child(name), kind: "removed_property", level: "major", detail: "field removed" });
      }
    }
    for (const name of Object.keys(newProps)) {
      if (!(name in oldProps)) {
        const required = newReq.has(name);
        changes.push({
          path: child(name),
          kind: required ? "new_required_property" : "new_optional_property",
          level: required ? "major" : "minor",
          detail: required ? "new field that callers MUST send" : "new field callers may send",
        });
        continue;
      }
      if (!oldReq.has(name) && newReq.has(name)) {
        changes.push({ path: child(name), kind: "became_required", level: "major", detail: "optional field is now required" });
      }
      if (oldReq.has(name) && !newReq.has(name)) {
        changes.push({ path: child(name), kind: "became_optional", level: "minor", detail: "required field is now optional" });
      }
      compareNode(oldProps[name], newProps[name], child(name), changes);
    }
  }

  // 5. Arrays: compare the schema of each item, shown as "field[]".
  if (oldNode.items || newNode.items) {
    compareNode(oldNode.items || {}, newNode.items || {}, `${path}[]`, changes);
  }

  // 6. Fail safe on anything else (pattern, format, maximum, additionalProperties ...).
  const otherKeys = new Set([...Object.keys(oldNode), ...Object.keys(newNode)].filter((k) => !KNOWN.has(k)));
  for (const key of otherKeys) {
    if (JSON.stringify(oldNode[key]) !== JSON.stringify(newNode[key])) {
      add("unrecognised_change", "major", `"${key}" changed; not understood, so treated as breaking`);
    }
  }
}

// Classify the change between two versions of a tool definition.
// Returns { level, changes } where level is the highest level found.
export function classifyToolChange(oldTool, newTool) {
  const changes = [];
  if (oldTool.name !== newTool.name) {
    changes.push({ path: "(tool)", kind: "renamed", level: "major", detail: `${oldTool.name} -> ${newTool.name}` });
  }
  if ((oldTool.description || "") !== (newTool.description || "")) {
    changes.push({ path: "(tool)", kind: "description_changed", level: "patch", detail: "tool description edited" });
  }
  compareNode(oldTool.input_schema, newTool.input_schema, "", changes);
  const level = changes.reduce((acc, c) => highest(acc, c.level), "none");
  return { level, changes };
}
