// report.js
//
// Turns a promotion result into plain text a release manager (or a CI log
// reader) can scan: one line per tool or prompt, one line per eval, and a
// final verdict. Kept separate from promote.js so the rules stay readable.

const pad = (s, n) => String(s).padEnd(n);

export function formatChanges(changes, indent = "      ") {
  return changes.map((c) => `${indent}- ${c.path}: ${c.kind} (${c.level}) ${c.detail}`);
}

export function formatPromotion(result) {
  const lines = [`Promotion ${result.from} -> ${result.to}${result.dryRun ? " (dry run)" : ""}`];
  if (result.reason && result.items.length === 0) {
    lines.push(`  BLOCKED: ${result.reason}`);
    lines.push(`RESULT: BLOCKED, ${result.to}.json not changed`);
    return lines.join("\n");
  }

  for (const item of result.items) {
    const kind = item.kind === "tools" ? "tool" : "prompt";
    const versions = `${item.from ?? "(none)"} -> ${item.to ?? "(none)"}`;
    if (item.status === "unchanged") {
      lines.push(`  ${pad(kind, 7)}${pad(item.name, 22)}${pad(item.from, 18)}unchanged`);
      continue;
    }
    const levels = item.level ? `change ${pad(item.level, 6)}bump ${pad(item.bump, 6)}` : "";
    const verdict = item.ok ? "OK" : `BLOCKED: ${item.reason}`;
    lines.push(`  ${pad(kind, 7)}${pad(item.name, 22)}${pad(versions, 18)}${levels}${verdict}`);
    if (item.changes) lines.push(...formatChanges(item.changes));
  }

  for (const e of result.evals) {
    const pct = (x) => `${Math.round(x * 100)}%`;
    const verdict = e.ok ? "OK" : "BLOCKED: below threshold";
    lines.push(`  ${pad("eval", 7)}${pad(e.prompt, 22)}${e.passed}/${e.total} passed (${pct(e.passRate)}), threshold ${pct(e.threshold)}  ${verdict}`);
    for (const r of e.results.filter((x) => !x.pass)) {
      const why = [...r.forbidden.map((s) => `contains "${s}"`), ...r.missing.map((s) => `missing "${s}"`)].join(", ");
      lines.push(`      - ${r.id} failed: ${why}`);
    }
  }

  if (!result.ok) lines.push(`RESULT: BLOCKED, ${result.to}.json not changed`);
  else if (result.written) lines.push(`RESULT: PROMOTED, ${result.to}.json updated`);
  else lines.push(`RESULT: WOULD PROMOTE (dry run), ${result.to}.json not changed`);
  return lines.join("\n");
}
