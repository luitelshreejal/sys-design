// tracing.js
//
// OpenTelemetry setup. OpenTelemetry (OTel) is the open standard for traces:
// a TRACE is the story of one request, made of SPANS (timed steps) that point
// to their parent span, so a tool can draw them as a tree.
//
// We send every finished span to two "exporters" (destinations):
//   - the console, using the official ConsoleSpanExporter, and
//   - a local file, traces/trace.jsonl, using the small exporter below.
// Production would replace both with an OTLP exporter that ships spans to
// an observability backend, using a BatchSpanProcessor (which sends spans in
// groups) instead of SimpleSpanProcessor (which sends each span right away).

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { ExportResultCode, hrTimeToMilliseconds } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider, SimpleSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";

// A finished span as plain JSON: ids, parent, name, kind, timing, status,
// and attributes. One JSON object per line (JSON Lines).
export function spanToJson(span) {
  return {
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId ?? null, // SDK 2.x field name
    name: span.name,
    kind: SpanKind[span.kind],
    startMs: hrTimeToMilliseconds(span.startTime),
    durationMs: Math.round(hrTimeToMilliseconds(span.duration) * 1000) / 1000,
    status: { code: SpanStatusCode[span.status.code], message: span.status.message },
    attributes: span.attributes,
    service: span.resource.attributes["service.name"],
  };
}

// A minimal custom exporter. An exporter only needs export() and shutdown().
export class JsonFileSpanExporter {
  constructor(path) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, ""); // start fresh on every run
  }
  export(spans, resultCallback) {
    try {
      for (const span of spans) appendFileSync(this.path, JSON.stringify(spanToJson(span)) + "\n");
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (error) {
      resultCallback({ code: ExportResultCode.FAILED, error });
    }
  }
  shutdown() {
    return Promise.resolve();
  }
  forceFlush() {
    return Promise.resolve();
  }
}

// Build and register a tracer provider. register() also installs the context
// manager, which is what lets a span started inside another span's callback
// pick the right parent automatically.
export function setupTracing({ serviceName = "precall-agent", consoleOutput = true, jsonPath, exporters = [] } = {}) {
  const all = [...exporters];
  if (consoleOutput) all.push(new ConsoleSpanExporter());
  if (jsonPath) all.push(new JsonFileSpanExporter(jsonPath));
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "service.name": serviceName }),
    spanProcessors: all.map((exporter) => new SimpleSpanProcessor(exporter)),
  });
  provider.register();
  return { provider, tracer: provider.getTracer("c6-traced-agent-loop", "1.0.0") };
}
