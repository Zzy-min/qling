import {
  fg,
  progressStageColor,
  progressStageLabel,
  resolveProgressStage,
} from "./theme.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function formatProgressDuration(ms: number): string {
  const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
  if (safeMs < 60_000) {
    return `${(safeMs / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * 阶段语义进度行：思考 / 工具 / 恢复 / agent
 * 色相区分，避免千篇一律 spinner。
 */
export function formatProgressPulse(label: string, elapsedMs: number): string {
  const stage = resolveProgressStage(label);
  const stageLabel = progressStageLabel(stage, label);
  const frame = SPINNER_FRAMES[Math.floor(elapsedMs / 80) % SPINNER_FRAMES.length];
  const color = progressStageColor(stage);
  const body = `${frame}  ${stageLabel} 仍在运行 (${formatProgressDuration(elapsedMs)})`;
  return fg(color, body);
}
