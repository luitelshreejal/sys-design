// cost-log.js
//
// Cost attribution: one line of JSON per request, appended to a file
// (JSON Lines, or JSONL). Each line says WHO spent (team, user), on WHAT
// (model, tokens), HOW MUCH (cost in dollars from the placeholder price
// table), and WHY (route reason, fallback, cache hit).
//
// JSONL is easy to load into Snowflake (COPY INTO from a stage, then query the
// VARIANT column), so FinOps can build chargeback reports by team and user
// without asking engineering for a custom export.
//
// Production would ship these lines to a log pipeline instead of a local file,
// and would never write prompt or answer text here: the log is for money, and
// prompts can contain HCP or patient details.

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export function createCostLog(path) {
  mkdirSync(dirname(path), { recursive: true });
  return {
    path,
    write(entry) {
      appendFileSync(path, JSON.stringify(entry) + "\n");
    },
    readAll() {
      if (!existsSync(path)) return [];
      return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    },
  };
}
