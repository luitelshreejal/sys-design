// semver.js
//
// A tiny, hand-rolled semantic versioning helper. A semantic version is three
// numbers, MAJOR.MINOR.PATCH, and each number carries a promise to callers:
//
//   MAJOR  "I broke something. Callers must change their code or retest."
//   MINOR  "I added something. Old callers keep working."
//   PATCH  "I only fixed wording or a bug. Nothing visible changed."
//
// We hand-roll this instead of using the popular "semver" npm package so you
// can see every rule. Production code would usually use that package, which
// also handles pre-release tags such as 2.0.0-rc.1 (we do not).

// The four change levels, lowest to highest. "none" means nothing changed.
export const LEVELS = ["none", "patch", "minor", "major"];

// Return the higher of two levels, for example highest("minor", "major") is "major".
export function highest(a, b) {
  return LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b;
}

// "1.4.2" becomes { major: 1, minor: 4, patch: 2 }. Anything else is an error,
// because a registry with sloppy version strings cannot be checked.
export function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!match) throw new Error(`Not a MAJOR.MINOR.PATCH version: "${version}"`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

// Negative if a < b, zero if equal, positive if a > b.
export function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch;
}

// Which number did the author bump between two versions?
// 1.4.2 -> 2.0.0 is "major", 1.4.2 -> 1.5.0 is "minor", 1.4.2 -> 1.4.3 is "patch".
// Returns "not_increasing" when the new version is the same or lower.
export function bumpLevel(from, to) {
  if (compare(to, from) <= 0) return "not_increasing";
  const x = parse(from);
  const y = parse(to);
  if (y.major !== x.major) return "major";
  if (y.minor !== x.minor) return "minor";
  return "patch";
}

// THE PROMOTION RULE. The bump the author chose must MATCH the change we
// detected, exactly.
//
// - Under-bump (a breaking change labelled minor or patch) is rejected because
//   every consumer that trusts the version number would break without warning.
// - Over-bump (a typo fix labelled major) is also rejected. It is not dangerous,
//   but it forces every consumer team to schedule a needless retest, and if
//   major bumps become routine people stop reading them. Some teams allow
//   over-bumping; we chose the strict rule because it is easier to audit.
export function checkBump(from, to, detectedLevel) {
  const bump = bumpLevel(from, to);
  if (bump === "not_increasing") {
    return { ok: false, bump, reason: `version must increase (${from} -> ${to})` };
  }
  if (detectedLevel === "none") {
    return { ok: false, bump, reason: "version changed but the artifact content did not" };
  }
  if (bump !== detectedLevel) {
    const kind = LEVELS.indexOf(bump) < LEVELS.indexOf(detectedLevel) ? "under-bump" : "over-bump";
    return { ok: false, bump, reason: `${kind}: change is ${detectedLevel} but version bump is ${bump}` };
  }
  return { ok: true, bump, reason: "bump matches change" };
}
