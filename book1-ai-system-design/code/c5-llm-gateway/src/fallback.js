// fallback.js
//
// Try each entry of a fallback chain in order until one answers.
//
// Two things make an entry "fail" and move us to the next one:
//   1. The provider throws a RETRYABLE error (overloaded, rate limited,
//      network trouble). See providers/errors.js.
//   2. The provider is too slow. We start a timer, and when it fires we abort
//      the call. A gateway must own its timeouts: if it waits as long as the
//      slowest provider, every app behind it inherits that slowness.
//
// A NON-retryable error (a malformed request, a refusal) stops the chain at
// once. Sending a broken request to a second, more expensive model would only
// fail again, cost more, and hide the bug.

import { ProviderError } from "./providers/errors.js";

export async function callWithFallback({ chain, providers, timeoutMs, run }) {
  const attempts = []; // what went wrong at each step, for the cost log
  for (const entry of chain) {
    const provider = providers[entry.provider];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await run(provider, entry.model, controller.signal);
      return { result, entry, attempts };
    } catch (err) {
      const error = controller.signal.aborted
        ? new ProviderError("timeout", `${entry.model} did not answer within ${timeoutMs} ms`, { retryable: true, status: 504 })
        : err;
      attempts.push({ model: entry.model, kind: error.kind ?? "unknown", message: error.message });
      if (!error.retryable) throw Object.assign(error, { attempts });
    } finally {
      clearTimeout(timer);
    }
  }
  // Every entry failed with a retryable error.
  const last = attempts[attempts.length - 1];
  throw Object.assign(new ProviderError("all_failed", `all ${chain.length} models in the chain failed (last: ${last.message})`, { retryable: true, status: 503 }), { attempts });
}
