// ============================================================
// 轻灵 TUI v2 - 配色系统 + ANSI 样式函数
// 参考：Claude Code / OpenCode / Warp / Linear 暗色风格
// ============================================================

// --- 配色系统 ---
export const C = {
  // 背景层级
  bg: {
    root:   "#080B0F",  // 最深层：终端背景
    panel:  "#0D1117",  // 面板背景
    card:   "#111821",  // 卡片背景
    hover:  "#1C2535",  // 悬浮/选中
    active: "#243044",  // 激活态
  },

  // 边框
  border: {
    weak: "#26323D",   // 弱分隔线
    mid:  "#2E3D4F",   // 面板边框
    strong: "#3D5066", // 强调边框
  },

  // 品牌色
  brand: {
    primary:   "#36F5B5",  // 主色（品牌/交互）
    secondary: "#75D7FF", // 辅助色（次要高亮）
    tertiary:  "#A78BFA", // 第三色（修复态）
  },

  // 语义色
  status: {
    success: "#4ADE80", // PASS / 成功
    warning: "#FACC15", // WARN / 警告
    error:   "#FB7185", // FAIL / 错误
    info:    "#75D7FF", // 信息
  },

  // 文字
  text: {
    primary:   "#E6EDF3",  // 主要文字
    secondary: "#8B949E",  // 次要文字（标签/说明）
    muted:     "#4A5568",  // 占位/禁用
    inverse:   "#0D1117",  // 反色（用于高亮背景上的文字）
  },

  // 特殊元素
  special: {
    user:    "#75D7FF", // 用户消息边框
    agent:   "#36F5B5", // Agent 消息边框
    plan:    "#A78BFA", // 计划
    tool:    "#FACC15", // 工具
    repair:  "#C084FC", // 修复
    dim:     "#26323D", // 暗淡元素
  },
} as const;

// --- ANSI 24bit 真彩色 + 样式函数 ---
type ANSIStr = (s: string) => string;

function rgb(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}
function bgRgb(r: number, g: number, b: number): string {
  return `\x1b[48;2;${r};${g};${b}m`;
}
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function F(col: string): ANSIStr {
  const [r, g, b] = hexToRgb(col);
  return (s: string) => `${rgb(r, g, b)}${s}\x1b[0m`;
}
function B(col: string): ANSIStr {
  const [r, g, b] = hexToRgb(col);
  return (s: string) => `${bgRgb(r, g, b)}${s}\x1b[0m`;
}

// 基础样式
export const S = {
  // 颜色
  primary:   F(C.text.primary),
  secondary: F(C.text.secondary),
  muted:     F(C.text.muted),
  highlight: F("#FFFFFF"),

  // 品牌色
  brand:     F(C.brand.primary),
  brandSec:  F(C.brand.secondary),
  brandTri:  F(C.brand.tertiary),

  // 语义色
  success:   F(C.status.success),
  warning:   F(C.status.warning),
  error:     F(C.status.error),
  info:      F(C.status.info),

  // 特殊元素
  user:      F(C.special.user),
  agent:     F(C.special.agent),
  plan:      F(C.special.plan),
  tool:      F(C.special.tool),
  repair:    F(C.special.repair),
  dim:       F(C.special.dim),

  // 背景色
  bgPanel:   B(C.bg.panel),
  bgCard:    B(C.bg.card),
  bgHover:   B(C.bg.hover),
  bgActive:  B(C.bg.active),

  // 边框色（仅前景，用于画线）
  bdr:       F(C.border.mid),
  bdrWeak:   F(C.border.weak),
};

// --- 布局字符 ---
export const BDR = {
  topLeft:     "╭",
  topRight:    "╮",
  bottomLeft:  "╰",
  bottomRight: "╯",
  horiz:       "─",
  vert:        "│",
  teeRight:    "├",
  teeLeft:     "┤",
  teeTop:      "┬",
  teeBottom:   "┴",
  cross:       "┼",
  horizThick:  "━",
  vertThick:   "┃",
};

// --- 工具函数 ---
export function padRight(s: string, n: number): string {
  const len = stripAnsi(s).length;
  return s + " ".repeat(Math.max(0, n - len));
}

export function padLeft(s: string, n: number): string {
  const len = stripAnsi(s).length;
  return " ".repeat(Math.max(0, n - len)) + s;
}

export function truncate(s: string, n: number): string {
  const raw = stripAnsi(s);
  if (raw.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function center(s: string, w: number): string {
  const raw = stripAnsi(s);
  const pad = Math.max(0, w - raw.length);
  return " ".repeat(Math.floor(pad / 2)) + s + " ".repeat(Math.ceil(pad / 2));
}

export function fillAnsi(s: string, w: number): string {
  const raw = stripAnsi(s);
  const pad = Math.max(0, w - raw.length);
  return s + " ".repeat(pad);
}

// 画顶部边框（完整宽度）
export function boxTop(w: number): string {
  return `${S.dim(BDR.topLeft)}${BDR.horiz.repeat(w - 2)}${S.dim(BDR.topRight)}`;
}

// 画底部边框（完整宽度）
export function boxBottom(w: number): string {
  return `${S.dim(BDR.bottomLeft)}${BDR.horiz.repeat(w - 2)}${S.dim(BDR.bottomRight)}`;
}

// 画中间分隔边框（完整宽度）
export function boxMid(w: number): string {
  return `${S.dim(BDR.teeRight)}${BDR.horiz.repeat(w - 2)}${S.dim(BDR.teeLeft)}`;
}

// 弱分隔线
export function divider(char = "─", len?: number): string {
  return S.dim(char.repeat(len ?? 40));
}

// 状态徽章
export function badge(label: string, color: string): string {
  return `${F(color)("[ ")}${F(color)(label)}${F(color)(" ]")}`;
}

// Agent 状态图标
export function stateIcon(state: string): string {
  switch (state) {
    case "idle":       return S.secondary("●");
    case "analyzing":  return S.brand("◐");
    case "planning":   return S.brandSec("◑");
    case "executing":  return S.brand("◓");
    case "answering":  return S.brandSec("◎");
    case "error":      return S.error("✕");
    case "repairing":  return S.repair("↻");
    default:           return S.secondary("○");
  }
}

// PASS / FAIL badge
export function verdictBadge(v: "PASS" | "FAIL" | "PARTIAL" | "WARN"): string {
  switch (v) {
    case "PASS":    return S.success("[ ✓ PASS ]");
    case "FAIL":    return S.error("[ ✕ FAIL ]");
    case "PARTIAL": return S.warning("[ ⚠ PARTIAL ]");
    case "WARN":    return S.warning("[ ⚠ WARN ]");
  }
}

// Running 旋转字符
let tick = 0;
const spinChars = ["◐", "◓", "◑", "◒"];
export function spin(): string {
  return S.brand(spinChars[tick++ % spinChars.length]);
}

export function spinChar(): string {
  return spinChars[tick % spinChars.length];
}
