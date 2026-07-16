import { createHash } from "node:crypto";
import type { Context, Span, Tracer } from "@opentelemetry/api";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { resolveOtelExportConfig, type OtelExportConfig } from "../metrics/otel-config.js";

type ExportResult = { code: number; error?: Error };

export interface OtelExecutionEvent {
  runId: string;
  sessionId?: string;
  toolCallId?: string;
  type: string;
  timestamp: number;
  stage?: string;
  status?: string;
  tool?: string;
  category?: string;
  durationMs?: number;
}

export interface OtelTraceBridgeOptions {
  sessionId: string;
  version: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  exporter?: SpanExporter;
  onDisabled?: (reason: string) => void;
}

const STATUSES = new Set([
  "queued", "running", "awaiting_approval", "recovering", "paused",
  "succeeded", "failed", "canceled",
]);
const STAGES = new Set([
  "run", "attempt", "agent", "provider", "tool", "verification", "recovery", "compaction",
]);
const CATEGORIES = new Set([
  "provider_transient", "provider_terminal", "invalid_tool_arguments", "permission_required",
  "permission_denied", "sandbox_denied", "tool_not_found", "tool_execution",
  "verification_failed", "context_exhausted", "repeated_action", "no_progress", "user_canceled",
]);

function allowed(value: string | undefined, values: Set<string>): string {
  return value && values.has(value) ? value : "other";
}

export function genericToolKind(tool: string | undefined): string {
  const value = (tool ?? "").toLowerCase();
  if (/read|search|find|grep|list|inspect|view/.test(value)) return "read";
  if (/write|patch|edit|replace|delete|move|mkdir/.test(value)) return "write";
  if (/shell|command|exec|terminal|process/.test(value)) return "process";
  if (/browser|http|fetch|web|url/.test(value)) return "network";
  if (/mcp/.test(value)) return "mcp";
  if (/subtask|agent/.test(value)) return "subagent";
  return "other";
}

class DisableAfterFailureExporter implements SpanExporter {
  private disabled = false;

  constructor(
    private readonly inner: SpanExporter,
    private readonly onDisabled?: (reason: string) => void
  ) {}

  export(spans: ReadableSpan[], callback: (result: ExportResult) => void): void {
    if (this.disabled) {
      callback({ code: 0 });
      return;
    }
    try {
      this.inner.export(spans, (result) => {
        if (result.code !== 0) {
          this.disabled = true;
          this.onDisabled?.("export failed");
          callback({ code: 0 });
          return;
        }
        callback(result);
      });
    } catch {
      this.disabled = true;
      this.onDisabled?.("export failed");
      callback({ code: 0 });
    }
  }

  async shutdown(): Promise<void> {
    await this.inner.shutdown();
  }

  async forceFlush(): Promise<void> {
    await this.inner.forceFlush?.();
  }
}

export class OtelTraceBridge {
  private readonly runSpans = new Map<string, { span: Span; context: Context }>();
  private readonly toolSpans = new Map<string, Span>();

  constructor(
    private readonly tracer: Tracer,
    private readonly rootContext: Context,
    private readonly contextWithSpan: (context: Context, span: Span) => Context,
    private readonly statusError: number,
    private readonly provider: { forceFlush(): Promise<void>; shutdown(): Promise<void> },
    private readonly sessionHash: string,
    private readonly shutdownTimeoutMs: number
  ) {}

  record(event: OtelExecutionEvent): void {
    if (event.type === "run_started") {
      const span = this.tracer.startSpan("qling.run", {
        startTime: event.timestamp,
        attributes: { "qling.session.hash": this.sessionHash },
      });
      this.runSpans.set(event.runId, {
        span,
        context: this.contextWithSpan(this.rootContext, span),
      });
      return;
    }

    if (event.type === "tool_started" && event.toolCallId) {
      const parent = this.runSpans.get(event.runId)?.context;
      if (!parent) return;
      const span = this.tracer.startSpan("qling.tool", {
        startTime: event.timestamp,
        attributes: { "qling.tool.kind": genericToolKind(event.tool) },
      }, parent);
      this.toolSpans.set(event.toolCallId, span);
      return;
    }

    if (event.type === "tool_completed" && event.toolCallId) {
      const span = this.toolSpans.get(event.toolCallId);
      if (!span) return;
      const status = allowed(event.status, STATUSES);
      span.setAttribute("qling.tool.status", status);
      if (status === "failed" || status === "canceled") span.setStatus({ code: this.statusError });
      if (typeof event.durationMs === "number" && event.durationMs >= 0) {
        span.setAttribute("qling.duration_ms", Math.round(event.durationMs));
      }
      span.end(event.timestamp);
      this.toolSpans.delete(event.toolCallId);
      return;
    }

    const run = this.runSpans.get(event.runId);
    if (!run) return;
    if (event.category) run.span.setAttribute("qling.failure.category", allowed(event.category, CATEGORIES));
    if (event.stage) run.span.setAttribute("qling.stage", allowed(event.stage, STAGES));
    if (event.type === "run_completed") {
      const status = allowed(event.status, STATUSES);
      run.span.setAttribute("qling.run.status", status);
      if (status === "failed" || status === "canceled") run.span.setStatus({ code: this.statusError });
      if (typeof event.durationMs === "number" && event.durationMs >= 0) {
        run.span.setAttribute("qling.duration_ms", Math.round(event.durationMs));
      }
      run.span.end(event.timestamp);
      this.runSpans.delete(event.runId);
    }
  }

  async flush(): Promise<void> {
    await this.provider.forceFlush();
  }

  async shutdown(): Promise<void> {
    const now = Date.now();
    for (const span of this.toolSpans.values()) span.end(now);
    for (const run of this.runSpans.values()) run.span.end(now);
    this.toolSpans.clear();
    this.runSpans.clear();
    await this.withTimeout(this.flush());
    await this.withTimeout(this.provider.shutdown());
  }

  private async withTimeout(operation: Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<void>((_, reject) => {
          timer = setTimeout(() => reject(new Error("OTEL shutdown timeout")), this.shutdownTimeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export async function createOtelTraceBridge(
  options: OtelTraceBridgeOptions
): Promise<{ bridge: OtelTraceBridge | null; config: OtelExportConfig }> {
  const config = resolveOtelExportConfig(options.env ?? process.env);
  if (config.state !== "enabled" || !config.endpoint) return { bridge: null, config };

  const [{ ROOT_CONTEXT, SpanStatusCode, trace }, sdk, resources] = await Promise.all([
    import("@opentelemetry/api"),
    import("@opentelemetry/sdk-trace-base"),
    import("@opentelemetry/resources"),
  ]);
  const exporter = options.exporter ?? new (
    await import("@opentelemetry/exporter-trace-otlp-http")
  ).OTLPTraceExporter({
    url: config.endpoint,
    headers: config.headers,
    timeoutMillis: config.timeoutMs,
  });
  const safeExporter = new DisableAfterFailureExporter(exporter, options.onDisabled);
  const processor = new sdk.BatchSpanProcessor(safeExporter, {
    maxQueueSize: 256,
    maxExportBatchSize: 64,
    scheduledDelayMillis: config.batchDelayMs,
    exportTimeoutMillis: config.timeoutMs,
  });
  const provider = new sdk.BasicTracerProvider({
    resource: resources.resourceFromAttributes({
      "service.name": "qling",
      "service.version": options.version,
    }),
    spanProcessors: [processor],
    forceFlushTimeoutMillis: config.timeoutMs,
    spanLimits: { attributeCountLimit: 8, attributeValueLengthLimit: 64, eventCountLimit: 0 },
  });
  const tracer = provider.getTracer("qling.metadata", options.version);
  const sessionHash = createHash("sha256").update(options.sessionId).digest("hex").slice(0, 16);
  return {
    bridge: new OtelTraceBridge(
      tracer,
      ROOT_CONTEXT,
      (context, span) => trace.setSpan(context, span),
      SpanStatusCode.ERROR,
      provider,
      sessionHash,
      config.timeoutMs
    ),
    config,
  };
}
