// ============================================================
// 轻灵 - Agent Telemetry（Agent 遥测封装）
// ============================================================

import { MetricsCollector } from "./collector.js";

export class AgentTelemetry {
  private collector: MetricsCollector;
  private sessionId: string;

  constructor(collector: MetricsCollector, sessionId: string) {
    this.collector = collector;
    this.sessionId = sessionId;
  }

  recordTurnStart(turn: number): void {
    this.collector.record({ type: "turn_complete", data: { turn, phase: "start" } });
  }

  recordTurnEnd(turn: number, toolCalls: number, toolFailures: number, tokens: number): void {
    this.collector.record({
      type: "turn_complete",
      data: { turn, toolCalls, toolFailures, tokens },
    });
  }

  recordToolCall(toolName: string, durationMs: number, success: boolean): void {
    this.collector.record({
      type: success ? "tool_call" : "tool_error",
      data: { toolName, durationMs },
    });
  }

  recordCompaction(before: number, after: number): void {
    this.collector.record({
      type: "compaction",
      data: { before, after, removed: before - after },
    });
  }

  recordMemoryWrite(source: string): void {
    this.collector.record({
      type: "memory_write",
      data: { source },
    });
  }

  recordSessionEnd(): void {
    this.collector.record({ type: "session_end", data: {} });
  }

  async flush(): Promise<void> {
    await this.collector.flush();
  }
}
