// ============================================================
// 轻灵 - Metrics 类型
// ============================================================

export interface MetricEvent {
  ts: number;
  type: "turn_complete" | "tool_call" | "tool_error" | "memory_write" | "compaction" | "session_start" | "session_end";
  session_id: string;
  data: Record<string, unknown>;
}

export interface MetricsQuery {
  type?: string;
  session_id?: string;
  from?: number;
  to?: number;
  limit?: number;
}
