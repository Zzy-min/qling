// ============================================================
// focus-model — 对标 Grok AgentView 双焦点
// PromptFocused | ScrollbackFocused（见 agent_view/mod.rs 输入流）
// ============================================================

/**
 * Grok 源码模型（摘录）：
 * - prompt focused: 编辑 / slash / Submit；Tab → FocusScrollback
 * - scrollback focused: Space/i/Tab → FocusPrompt；↑↓ 导航条目
 * - Esc 策略独立于 vim/simple mode
 *
 * 轻灵 append-only 下的等价物：
 * - prompt: 输入框可编辑
 * - scrollback: 轮次/会话浮层占有输入槽，编辑键被吞掉
 */
export type TuiFocus = "prompt" | "scrollback";

/** 浮层是否占用「输入槽」（对标 jump_slot_taken） */
export type OverlayOwner =
  | "none"
  | "sessions"
  | "turns"
  | "options"
  | "slash"
  | "recovery";

export interface FocusSnapshot {
  focus: TuiFocus;
  overlay: OverlayOwner;
}

export function canEditPrompt(snap: FocusSnapshot): boolean {
  return snap.focus === "prompt" && snap.overlay === "none";
}

export function shouldRouteNavToOverlay(snap: FocusSnapshot): boolean {
  return (
    snap.overlay === "sessions" ||
    snap.overlay === "turns" ||
    snap.overlay === "options"
  );
}

/**
 * Tab 在空输入上的结构语义（对标 Grok Tab structural FocusScrollback）
 * - prompt + 空输入 → 进入 scrollback（轮次浏览）
 * - scrollback → 回 prompt
 * - sessions/options 浮层打开时不抢 Tab
 */
export function tabStructuralFocus(
  snap: FocusSnapshot,
  inputEmpty: boolean
): TuiFocus | null {
  if (!inputEmpty) return null;
  if (snap.overlay !== "none" && snap.overlay !== "turns") return null;
  if (snap.focus === "prompt") return "scrollback";
  return "prompt";
}

/** Space 在 scrollback 焦点：回 prompt（对标 panes.rs Space → FocusPrompt） */
export function spaceFocusPrompt(snap: FocusSnapshot): boolean {
  return snap.focus === "scrollback" || snap.overlay === "turns";
}
