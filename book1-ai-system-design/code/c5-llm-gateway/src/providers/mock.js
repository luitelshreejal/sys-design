// providers/mock.js
//
// A fake model provider so the gateway can run with no API key and no network.
// It behaves like a real provider in the ways the gateway cares about:
//   - it takes a model name, system prompt, messages, and max_tokens,
//   - it returns text plus token usage (input and output tokens),
//   - it can stream text in small pieces,
//   - it stops early if the gateway aborts the call (for timeouts).
//
// The answers are canned and deterministic (same input, same output), which
// makes tests and the demo repeatable. Token counts use the same rough
// "4 characters per token" estimate as the gateway.
//
// To make a model fail on purpose (to watch fallback work), wrap this
// provider with withFaults() from faults.js.

import { estimateTokens, estimateRequestTokens } from "../config.js";
import { ProviderError } from "./errors.js";

// Wait `ms`, but stop early (with an error) if the caller aborts.
export function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new ProviderError("aborted", "call aborted by the gateway", { retryable: true }));
    });
  });
}

export function createMockProvider({ latencyMs = 15 } = {}) {
  const calls = []; // every call, so tests can count how often a model was hit

  function answerFor({ model, messages }) {
    const question = messages[messages.length - 1].content.replace(/\s+/g, " ");
    const short = question.length > 60 ? `${question.slice(0, 60)}...` : question;
    return `[${model} mock] You asked: "${short}" A real model would answer here.`;
  }

  function result(request, text) {
    return {
      model: request.model,
      text,
      usage: { input_tokens: estimateRequestTokens(request), output_tokens: estimateTokens(text) },
    };
  }

  return {
    name: "mock",
    calls,

    async complete(request, { signal } = {}) {
      calls.push({ model: request.model, stream: false });
      await wait(latencyMs, signal);
      return result(request, answerFor(request));
    },

    // Streaming version: sends the same answer a few words at a time.
    async stream(request, { signal, onText } = {}) {
      calls.push({ model: request.model, stream: true });
      const text = answerFor(request);
      for (const piece of text.match(/\S+\s*/g)) {
        await wait(Math.max(1, Math.floor(latencyMs / 5)), signal);
        onText(piece);
      }
      return result(request, text);
    },
  };
}
