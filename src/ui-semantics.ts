/**
 * Shared UI semantics for both surfaces:
 * - TUI true-color palette (bamboo)
 * - Dashboard CSS tokens
 * - Dashboard task status labels
 *
 * Keep this module free of Node/DOM dependencies so it can be bundled into
 * the browser and imported by the TUI build.
 */
export const UI_SEMANTIC_COLORS = {
  ink: "#e8efe9",
  dim: "#87998c",
  primary: "#66d58b",
  secondary: "#a6eab9",
  warning: "#e7b65f",
  error: "#f095a2",
} as const;

export const TASK_STATUS_LABELS = {
  running: "运行中",
  queued: "等待",
  blocked: "阻塞",
  paused: "暂停",
  exhausted: "未完成",
  succeeded: "完成",
  failed: "失败",
  canceled: "取消",
} as const;

export type TaskStatusLabelKey = keyof typeof TASK_STATUS_LABELS;

export function taskStatusLabel(status: string): string {
  return TASK_STATUS_LABELS[status as TaskStatusLabelKey] ?? status;
}