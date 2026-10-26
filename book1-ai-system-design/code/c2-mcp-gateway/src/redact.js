// redact.js
//
// Output redaction: scrub personal contact details from tool results before
// they reach the agent (and therefore the model and its logs).
//
// This is pattern matching, so it is a safety net, not a guarantee. It will
// miss formats it does not know, which is why the upstream data product also
// uses an allow-list of fields (see C1). Defense in depth: both layers matter.

const PATTERNS = [
  // Email addresses: something@domain.tld
  { label: 'EMAIL', regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // US phone numbers WITH separators: 617-555-0142, 617.555.0177, (781) 555-0199.
  // We require separators on purpose. A pattern that also matched ten digits
  // in a row would redact every NPI, which is also ten digits.
  { label: 'PHONE', regex: /(?:\(\d{3}\)\s?|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g },
];

// Returns the redacted text and how many replacements were made (for the audit log).
export function redactText(text) {
  let count = 0;
  let out = text;
  for (const { label, regex } of PATTERNS) {
    out = out.replace(regex, () => {
      count += 1;
      return `[REDACTED_${label}]`;
    });
  }
  return { text: out, count };
}

// Apply redaction to every text block in an MCP tool result.
export function redactToolResult(result) {
  let total = 0;
  const content = (result.content || []).map((block) => {
    if (block.type !== 'text') return block;
    const { text, count } = redactText(block.text);
    total += count;
    return { ...block, text };
  });
  return { result: { ...result, content }, redactions: total };
}
