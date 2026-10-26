// redact.js
//
// Removes HCP contact details from anything we are about to write into a
// trace span.
//
// Why: traces leave the application. They go to an observability backend
// (Datadog, Grafana, Honeycomb, a Snowflake event table) that many engineers
// can search, often with longer retention and different access rules than
// the CRM. Contact details are personal data. They are allowed in the CRM
// and in the rep's answer, but not in a debugging tool. See Chapter 6.
//
// Two layers, because each one misses things the other catches:
//   1. Key-based: any field named like a contact field is replaced, whatever
//      its value looks like (catches addresses, which no pattern finds well).
//   2. Pattern-based: email addresses and phone numbers are replaced wherever
//      they appear inside text (catches a phone number the model wrote into
//      its answer).
//
// Redaction happens BEFORE span.setAttribute, so the unredacted value never
// enters the tracing pipeline at all.

const SENSITIVE_KEYS = new Set(["office_email", "office_phone", "office_address", "mobile", "home_address", "email", "phone"]);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]\d{4}\b/g;
export const MASK = "[REDACTED]";

export function redact(value) {
  if (typeof value === "string") return value.replace(EMAIL, MASK).replace(PHONE, MASK);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, SENSITIVE_KEYS.has(key) ? MASK : redact(v)]));
  }
  return value;
}

// Span attributes must be strings, numbers, booleans, or arrays of those, so
// structured values (tool arguments, tool results, messages) are stored as
// JSON text, after redaction.
export const redactedJson = (value) => JSON.stringify(redact(value));
