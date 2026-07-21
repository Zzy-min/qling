// ============================================================
// Grok 三态 Mode 的 UI 与能力描述（Normal / Plan / Always-approve）
// ============================================================

import { fg, TUI_COLORS } from "./theme.js";

export type GrokUiMode = "normal" | "plan" | "auto";

export function resolveGrokUiMode(
  sessionMode: string | null | undefined,
  permissionMode: string | null | undefined
): GrokUiMode {
  if (String(sessionMode ?? "").toLowerCase() === "plan") return "plan";
  if (String(permissionMode ?? "").toLowerCase() === "allow") return "auto";
  return "normal";
}

/** 顶栏 / 角标短标签 */
export function modeBadgeLabel(mode: GrokUiMode): string {
  switch (mode) {
    case "plan":
      return "plan";
    case "auto":
      return "auto";
    default:
      return "normal";
  }
}

/**
 * 模式语义色（描边 / 角标 / 分隔线）。
 * 固定语义色，不随 mono 整盘灰化，保证三态输入框一眼可辨。
 */
export function modeAccentHex(mode: GrokUiMode): string {
  switch (mode) {
    case "plan":
      // 青蓝：规划（mono 下仍保留色相）
      return "#38BDF8";
    case "auto":
      // 琥珀：免确认
      return "#FBBF24";
    default:
      // normal：主题主色；mono 用亮白描边与灰阶底区分
      return TUI_COLORS.primary === "#E5E7EB" || TUI_COLORS.primary === "#F9FAFB"
        ? "#F9FAFB"
        : TUI_COLORS.primary;
  }
}

/** 顶栏 Mode: 段着色（plain 文本 + 着色后） */
export function paintModeSegment(mode: GrokUiMode): string {
  const label = `Mode:${modeBadgeLabel(mode)}`;
  return fg(modeAccentHex(mode), label);
}

/** 输入框描边色 hex */
export function modeBorderHex(mode: GrokUiMode): string {
  return modeAccentHex(mode);
}

/**
 * 输入框顶边角标（一眼可辨三态）。
 * scrollLabel 优先（多行滚动提示）。
 */
export function modeInputTopLabel(mode: GrokUiMode, scrollLabel: string): string {
  if (scrollLabel) return scrollLabel;
  switch (mode) {
    case "plan":
      return "◈ plan · 只读规划";
    case "auto":
      return "⚡ auto · 免确认";
    default:
      return "› normal · 需确认";
  }
}

/** 输入行前缀：模式 glyph（与 normal 的 › 区分） */
export function modePromptPrefix(mode: GrokUiMode): string {
  switch (mode) {
    case "plan":
      return "◈ ";
    case "auto":
      return "⚡ ";
    default:
      return "› ";
  }
}

/** 底边能力微文案（空输入时显示，强化能力边界） */
export function modeCapabilityFooter(mode: GrokUiMode): string {
  switch (mode) {
    case "plan":
      return "只读规划 · 必须写 .qling/plans · 禁直接执行 · /plan approve 实施";
    case "auto":
      return "工具默认 allow · 危险仍可拦 · Ctrl+N 换行";
    default:
      return "工具需确认时弹审批 · Shift+Tab 切模式 · Ctrl+N 换行";
  }
}

/** 占位符：短、分模式 */
export function modePlaceholder(mode: GrokUiMode): string {
  switch (mode) {
    case "plan":
      return "规划任务…（只读 + 写 .qling/plans）";
    case "auto":
      return "输入任务…（auto：工具免确认）";
    default:
      return "输入任务，或按 / 打开命令面板";
  }
}

export interface ModeCapability {
  uiMode: GrokUiMode;
  /** 一句话能力 */
  summary: string;
  planMode: boolean;
  permissionDefault: "ask" | "allow";
  allowBash: boolean;
  allowBusinessWrite: boolean;
  allowPlanWrite: boolean;
  skipToolConfirm: boolean;
}

export function modeCapabilities(mode: GrokUiMode): ModeCapability {
  switch (mode) {
    case "plan":
      return {
        uiMode: "plan",
        summary: "只读规划；bash 禁；仅可写计划目录",
        planMode: true,
        permissionDefault: "ask",
        allowBash: false,
        allowBusinessWrite: false,
        allowPlanWrite: true,
        skipToolConfirm: false,
      };
    case "auto":
      return {
        uiMode: "auto",
        summary: "正常工具；权限默认 allow（免确认）",
        planMode: false,
        permissionDefault: "allow",
        allowBash: true,
        allowBusinessWrite: true,
        allowPlanWrite: true,
        skipToolConfirm: true,
      };
    default:
      return {
        uiMode: "normal",
        summary: "正常工具；权限默认 ask（需确认）",
        planMode: false,
        permissionDefault: "ask",
        allowBash: true,
        allowBusinessWrite: true,
        allowPlanWrite: true,
        skipToolConfirm: false,
      };
  }
}

/** 将 Grok UI 模式映射到 session + permission */
export function uiModeToSnapshot(uiMode: GrokUiMode): {
  sessionMode: "agent" | "plan";
  permissionMode: "ask" | "allow";
  uiMode: GrokUiMode;
} {
  if (uiMode === "plan") {
    return { sessionMode: "plan", permissionMode: "ask", uiMode: "plan" };
  }
  if (uiMode === "auto") {
    return { sessionMode: "agent", permissionMode: "allow", uiMode: "auto" };
  }
  return { sessionMode: "agent", permissionMode: "ask", uiMode: "normal" };
}

export function parseGrokUiMode(raw: string | null | undefined): GrokUiMode | null {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, "");
  if (!t) return null;
  if (t === "plan" || t === "规划" || t === "planning") return "plan";
  if (
    t === "auto" ||
    t === "alwaysapprove" ||
    t === "always" ||
    t === "allow" ||
    t === "免确认" ||
    t === "alwaysagree"
  ) {
    return "auto";
  }
  if (t === "normal" || t === "agent" || t === "ask" || t === "默认" || t === "normalmode") {
    return "normal";
  }
  return null;
}
