// ============================================================
// theme.ts — 轻灵 TUI design tokens + 主题包（G3.5）
// bamboo（默认）· night · mono
// ============================================================

export type TuiBorderStyle = "rounded" | "square";

export type ThemeId = "bamboo" | "night" | "mono";

export type TuiColorPalette = {
  primary: string;
  secondary: string;
  dim: string;
  bright: string;
  success: string;
  error: string;
  warn: string;
  magenta: string;
  thinking: string;
  tool: string;
  recovery: string;
};

export type TuiColorKey = keyof TuiColorPalette;

const THEME_PALETTES: Record<ThemeId, TuiColorPalette> = {
  /** 竹青绿 · 本地禅意工具台（默认） */
  bamboo: {
    primary: "#36F5B5",
    secondary: "#75D7FF",
    dim: "#8B949E",
    bright: "#E6EDF3",
    success: "#4ADE80",
    error: "#FB7185",
    warn: "#FACC15",
    magenta: "#E879F9",
    thinking: "#A5B4FC",
    tool: "#67E8F9",
    recovery: "#FDBA74",
  },
  /** 夜间：深蓝紫调 */
  night: {
    primary: "#7C9CFF",
    secondary: "#A78BFA",
    dim: "#6B7280",
    bright: "#E5E7EB",
    success: "#34D399",
    error: "#F87171",
    warn: "#FBBF24",
    magenta: "#E879F9",
    thinking: "#818CF8",
    tool: "#22D3EE",
    recovery: "#FB923C",
  },
  /**
   * 单色：正文/工具灰阶；
   * secondary/warn 保留轻色相，供非 modeAccent 路径的弱提示（mode 描边见 mode-chrome 固定色）
   */
  mono: {
    primary: "#F3F4F6",
    secondary: "#93C5FD",
    dim: "#6B7280",
    bright: "#FAFAFA",
    success: "#D1D5DB",
    error: "#FCA5A5",
    warn: "#FCD34D",
    magenta: "#D1D5DB",
    thinking: "#9CA3AF",
    tool: "#D1D5DB",
    recovery: "#FDBA74",
  },
};

const THEME_META: Record<ThemeId, { label: string; summary: string }> = {
  bamboo: { label: "bamboo", summary: "竹青绿（默认）" },
  night: { label: "night", summary: "夜间蓝紫" },
  mono: { label: "mono", summary: "单色灰阶" },
};

let activeThemeId: ThemeId = resolveThemeIdFromEnv();

/** 可变调色板：切换主题时 Object.assign，兼容既有 import */
export const TUI_COLORS: TuiColorPalette = { ...THEME_PALETTES.bamboo };

function applyPalette(id: ThemeId): void {
  Object.assign(TUI_COLORS, THEME_PALETTES[id]);
}

function resolveThemeIdFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): ThemeId {
  const raw = String(env.QLING_TUI_THEME ?? env.QLING_THEME ?? "bamboo")
    .trim()
    .toLowerCase();
  if (raw === "night" || raw === "dark") return "night";
  if (raw === "mono" || raw === "monochrome" || raw === "gray" || raw === "grey") {
    return "mono";
  }
  return "bamboo";
}

// 启动时应用 env
applyPalette(activeThemeId);

export function listThemes(): Array<{ id: ThemeId; label: string; summary: string; active: boolean }> {
  return (Object.keys(THEME_PALETTES) as ThemeId[]).map((id) => ({
    id,
    label: THEME_META[id].label,
    summary: THEME_META[id].summary,
    active: id === activeThemeId,
  }));
}

export function getActiveThemeId(): ThemeId {
  return activeThemeId;
}

export function getThemePalette(id?: ThemeId): TuiColorPalette {
  return { ...(THEME_PALETTES[id ?? activeThemeId] ?? THEME_PALETTES.bamboo) };
}

export function parseThemeId(raw: string | null | undefined): ThemeId | null {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!t) return null;
  if (t === "bamboo" || t === "default" || t === "green") return "bamboo";
  if (t === "night" || t === "dark") return "night";
  if (t === "mono" || t === "monochrome" || t === "gray" || t === "grey") return "mono";
  return null;
}

export function setTheme(id: ThemeId, env: NodeJS.ProcessEnv = process.env): ThemeId {
  activeThemeId = id;
  applyPalette(id);
  env.QLING_TUI_THEME = id;
  return id;
}

/** 从环境重新加载（测试/启动） */
export function reloadThemeFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): ThemeId {
  activeThemeId = resolveThemeIdFromEnv(env);
  applyPalette(activeThemeId);
  return activeThemeId;
}

export function formatThemeStatusLines(): string[] {
  const lines = [
    "",
    "🎨 【TUI 主题】",
    "-----------------------------------------",
    `Active    : ${activeThemeId} · ${THEME_META[activeThemeId].summary}`,
    `Env       : QLING_TUI_THEME=${process.env.QLING_TUI_THEME ?? "-"}`,
    "Primary   : " + TUI_COLORS.primary,
  ];
  for (const t of listThemes()) {
    lines.push(`  ${t.active ? "●" : "○"} ${t.id.padEnd(8)} ${t.summary}`);
  }
  lines.push("切换      : /theme bamboo|night|mono");
  lines.push("-----------------------------------------");
  lines.push("");
  return lines;
}

const BORDERS = {
  square: {
    tl: "┌",
    tr: "┐",
    bl: "└",
    br: "┘",
    h: "─",
    v: "│",
  },
  rounded: {
    tl: "╭",
    tr: "╮",
    bl: "╰",
    br: "╯",
    h: "─",
    v: "│",
  },
} as const;

export type BorderChars = {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string;
  v: string;
};

export function resolveBorderStyle(
  override?: TuiBorderStyle | string | null
): TuiBorderStyle {
  const raw = String(
    override ?? process.env.QLING_TUI_BORDER ?? "rounded"
  )
    .trim()
    .toLowerCase();
  return raw === "square" ? "square" : "rounded";
}

export function getBorderChars(style?: TuiBorderStyle | string | null): BorderChars {
  return BORDERS[resolveBorderStyle(style)];
}

function hexToRgbChannels(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`;
}

/** True-color foreground; empty string returns empty. */
export function fg(hex: string, text: string): string {
  if (!text) return "";
  return `\x1b[38;2;${hexToRgbChannels(hex)}m${text}\x1b[0m`;
}

export function fgKey(key: TuiColorKey, text: string): string {
  return fg(TUI_COLORS[key], text);
}

export const paint = {
  primary: (s: string) => fgKey("primary", s),
  secondary: (s: string) => fgKey("secondary", s),
  dim: (s: string) => fgKey("dim", s),
  bright: (s: string) => fgKey("bright", s),
  success: (s: string) => fgKey("success", s),
  error: (s: string) => fgKey("error", s),
  warn: (s: string) => fgKey("warn", s),
  magenta: (s: string) => fgKey("magenta", s),
  thinking: (s: string) => fgKey("thinking", s),
  tool: (s: string) => fgKey("tool", s),
  recovery: (s: string) => fgKey("recovery", s),
} as const;

export function dimAnsi(text: string): string {
  return `\x1b[2m${text}\x1b[0m`;
}

export function boldAnsi(text: string): string {
  return `\x1b[1m${text}\x1b[0m`;
}

export type ProgressStage = "thinking" | "tool" | "recovery" | "agent";

export function resolveProgressStage(label: string): ProgressStage {
  const t = label.trim().toLowerCase();
  if (!t) return "agent";
  if (/think|思考|cogitat|reason|推理/.test(t)) return "thinking";
  if (/tool|工具|exec|bash|命令|read|write|search/.test(t)) return "tool";
  if (/recover|恢复|retry|重试|repair|修复/.test(t)) return "recovery";
  if (/思考|工具|恢复/.test(label)) {
    if (label.includes("思考")) return "thinking";
    if (label.includes("工具")) return "tool";
    if (label.includes("恢复")) return "recovery";
  }
  return "agent";
}

export function progressStageColor(stage: ProgressStage): string {
  switch (stage) {
    case "thinking":
      return TUI_COLORS.thinking;
    case "tool":
      return TUI_COLORS.tool;
    case "recovery":
      return TUI_COLORS.recovery;
    default:
      return TUI_COLORS.primary;
  }
}

export function progressStageLabel(stage: ProgressStage, raw: string): string {
  const fallback = raw.trim() || "agent";
  switch (stage) {
    case "thinking":
      return fallback.includes("思考") ? fallback : "思考";
    case "tool":
      return fallback.includes("工具") ? fallback : "工具";
    case "recovery":
      return fallback.includes("恢复") ? fallback : "恢复";
    default:
      return fallback;
  }
}

export function timelineStatusIcon(status: "running" | "success" | "error"): string {
  if (status === "error") return "×";
  if (status === "success") return "✓";
  return "·";
}

export function timelineStatusColor(status: "running" | "success" | "error"): string {
  if (status === "error") return TUI_COLORS.error;
  if (status === "success") return TUI_COLORS.success;
  return TUI_COLORS.tool;
}
