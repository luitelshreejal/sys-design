// providers/errors.js
//
// One error type that every provider (mock or real) throws, so the gateway's
// fallback logic does not need to know each vendor's error classes.
//
// The key field is `retryable`:
//   - true  means "this model or provider is having a bad moment" (overloaded,
//           rate limited, network problem, timeout). Trying the next entry in
//           the fallback chain is sensible.
//   - false means "the request itself is the problem" (malformed request,
//           bad credentials, a refusal). Sending the same request to another
//           model would fail the same way or hide a real bug, so we stop.

export class ProviderError extends Error {
  constructor(kind, message, { retryable, status } = {}) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind; // "timeout" | "rate_limit" | "server_error" | "connection" | "bad_request" | "refusal" | ...
    this.retryable = retryable ?? false;
    this.status = status ?? 502; // HTTP status the gateway returns if nothing in the chain succeeds
  }
}
