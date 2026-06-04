export function formatProgressDuration(ms: number): string {
  const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
  if (safeMs < 60_000) {
    return `${(safeMs / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatProgressPulse(label: string, elapsedMs: number): string {
  const stage = label.trim() || "agent";
  return `... ${stage} 仍在运行 ${formatProgressDuration(elapsedMs)}`;
}
