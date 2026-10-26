// rate-limiter.js
//
// Per-user rate limiting with a "sliding window": remember the time of each
// call a user made in the last 60 seconds; if there are already N, refuse.
//
// Why per user and not just per agent? A runaway agent loop for one rep
// should not use up capacity for every other rep, and a per-user cap also
// limits how fast one stolen token can pull data out.
//
// Memory only: if the gateway restarts, counts reset, and two gateway copies
// do not share counts. Production would keep counters in Redis or similar.

export class RateLimiter {
  constructor({ windowMs = 60_000, now = () => Date.now() } = {}) {
    this.windowMs = windowMs;
    this.now = now;          // injectable clock, so tests can control time
    this.calls = new Map();  // user -> array of call timestamps
  }

  // Returns true if the call may go ahead (and records it), false if over the limit.
  tryAcquire(user, limit) {
    const now = this.now();
    const recent = (this.calls.get(user) || []).filter((t) => now - t < this.windowMs);
    if (recent.length >= limit) {
      this.calls.set(user, recent);
      return false;
    }
    recent.push(now);
    this.calls.set(user, recent);
    return true;
  }
}
