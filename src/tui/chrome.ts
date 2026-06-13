export interface TuiHeaderOptions {
  model: string;
  tools: number;
  cwd: string;
}

function normalizeCwd(cwd: string): string {
  const normalized = cwd.trim();
  if (!normalized) return "-";
  return normalized.replace(/\\/g, "/").replace(/^C:/, "C:");
}

function normalizeToolCount(tools: number): number {
  if (!Number.isFinite(tools) || tools <= 0) return 0;
  return Math.floor(tools);
}

export function formatTuiHeader(options: TuiHeaderOptions): string[] {
  const model = options.model.trim() || "unknown";
  const tools = normalizeToolCount(options.tools);
  const workspace = normalizeCwd(options.cwd);

  return [
    "轻灵 · Agent CLI",
    `model=${model}  tools=${tools}  mode=local-first`,
    `workspace=${workspace}`,
    "/help slash · Tab agents · Ctrl+Z restore · Ctrl+O output · /privacy boundary",
  ];
}
