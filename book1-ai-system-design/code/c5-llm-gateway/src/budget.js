// budget.js
//
// Per-team daily token budgets.
//
// How it works, in the order the gateway uses it:
//   1. BEFORE a call, check whether the team can afford the WORST case:
//      the estimated input tokens plus the max_tokens the caller asked for.
//      If not, reject with HTTP 429 and do not call the model at all.
//   2. AFTER a call, charge the team the ACTUAL tokens the provider reported.
//
// Checking the worst case up front means a team can never blow through its
// budget on its last request of the day. The price is that a request can be
// refused while a little budget is still left. That is a deliberate choice,
// and the alternative (allowing a small overspend) is also reasonable. Write
// whichever you choose into the spec.
//
// Production would keep counters in a shared store (Redis, a database) so
// every gateway instance sees the same numbers, and would budget in dollars
// as well as tokens. Here it is a Map in memory that resets per calendar day.

export function createBudgets(config, { today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const used = new Map(); // "team|YYYY-MM-DD" -> tokens used
  const key = (team) => `${team}|${today()}`;
  const limit = (team) => config.teams[team]?.daily_token_budget ?? 0;

  return {
    used: (team) => used.get(key(team)) ?? 0,
    remaining: (team) => Math.max(0, limit(team) - (used.get(key(team)) ?? 0)),
    canAfford(team, worstCaseTokens) {
      return worstCaseTokens <= this.remaining(team);
    },
    charge(team, tokens) {
      used.set(key(team), (used.get(key(team)) ?? 0) + tokens);
    },
    report() {
      return Object.keys(config.teams).map((team) => ({
        team,
        daily_token_budget: limit(team),
        used: this.used(team),
        remaining: this.remaining(team),
      }));
    },
  };
}
