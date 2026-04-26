// ============================================================
// 轻灵 TUI - 数据模型
// ============================================================

// --- 工具状态 ---
export type ToolStatus = "waiting" | "running" | "pass" | "fail" | "repairing" | "skipped";

// --- 工具调用记录 ---
export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: ToolStatus;
  output: string;
  errorType?: string;
  durationMs?: number;
  startedAt?: number;
  expanded?: boolean;
}

// --- 验证结果 ---
export type Verdict = "PASS" | "FAIL" | "PARTIAL";

// --- 验证记录 ---
export interface ValidationRecord {
  operation: string;
  expected: string;
  actual: string;
  verdict: Verdict;
  details: string;
  steps?: Array<{ description: string; passed: boolean; output?: string }>;
}

// --- 修复记录 ---
export interface RepairRecord {
  id: string;
  description: string;
  status: "pending" | "running" | "success" | "fail";
  error?: string;
}

// --- Timeline Item 联合类型 ---
export type TimelineItem =
  | { type: "user"; id: string; content: string; timestamp: number }
  | { type: "thinking"; id: string; content: string; state?: "thinking" | "planning" | "executing" | "answering"; timestamp: number }
  | { type: "plan"; id: string; plan: { id: string; items: PlanItem[]; status: string }; timestamp: number }
  | { type: "tool_call"; id: string; calls: ToolCallRecord[]; timestamp: number }
  | { type: "validation"; id: string; validation: ValidationRecord; timestamp: number }
  | { type: "repair"; id: string; repairs: RepairRecord[]; timestamp: number }
  | { type: "answer"; id: string; content: string; timestamp: number };

export interface PlanItem {
  id: string;
  content: string;
  status: "pending" | "active" | "done";
  index: number;
}

// --- 工具状态图标 ---
export const TOOL_STATUS_ICONS: Record<ToolStatus, string> = {
  waiting:   "○",
  running:   "◐",
  pass:     "✓",
  fail:     "✕",
  repairing: "↻",
  skipped:   "–",
};

export const TOOL_STATUS_LABELS: Record<ToolStatus, string> = {
  waiting:   "等待",
  running:   "运行中",
  pass:     "通过",
  fail:     "失败",
  repairing: "修复中",
  skipped:   "跳过",
};
