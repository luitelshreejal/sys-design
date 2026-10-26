// providers/faults.js
//
// Fault injection: wrap any provider (mock or real) so that calls to one
// chosen model fail on purpose. This is how you test fallback without waiting
// for a real outage. Teams that run gateways in production do the same thing
// in staging ("chaos testing") to prove the fallback path actually works.
//
// Fault modes, set per model with setFault(model, mode):
//   "error"       a retryable server error (like HTTP 529 "overloaded")
//   "timeout"     never answers; the gateway's own timeout must rescue the request
//   "bad_request" a non-retryable error (the request itself is wrong)
// setFault(model, null) clears the fault.

import { ProviderError } from "./errors.js";
import { wait } from "./mock.js";

export function withFaults(provider) {
  const faults = new Map(); // model name -> fault mode

  async function maybeFail(model, signal) {
    const mode = faults.get(model);
    if (mode === "error") {
      throw new ProviderError("server_error", `${model} is overloaded (simulated)`, { retryable: true, status: 503 });
    }
    if (mode === "bad_request") {
      throw new ProviderError("bad_request", `${model} rejected the request (simulated)`, { retryable: false, status: 400 });
    }
    if (mode === "timeout") {
      await wait(60_000, signal); // hangs until the gateway gives up and aborts
    }
  }

  return {
    ...provider,
    name: provider.name,
    setFault(model, mode) {
      if (mode) faults.set(model, mode);
      else faults.delete(model);
    },
    async complete(request, options = {}) {
      await maybeFail(request.model, options.signal);
      return provider.complete(request, options);
    },
    async stream(request, options = {}) {
      await maybeFail(request.model, options.signal);
      return provider.stream(request, options);
    },
  };
}
