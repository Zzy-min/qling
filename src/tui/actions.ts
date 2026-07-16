// ============================================================
// actions — 对标 Grok actions/defaults.rs：按键集中定义，不散落 if-else
// 轻灵 MVP：仅 G1 相关动作 + When 上下文
// ============================================================

export type ActionWhen =
  | "always"
  | "prompt_focused"
  | "scrollback_focused"
  | "overlay_open"
  | "input_empty";

export type ActionId =
  | "open_session_picker"
  | "focus_scrollback"
  | "focus_prompt"
  | "overlay_up"
  | "overlay_down"
  | "overlay_confirm"
  | "overlay_dismiss"
  | "turn_prev"
  | "turn_next"
  | "viewport_page_up"
  | "viewport_page_down"
  | "expand_tools"
  | "submit"
  | "redraw";

export interface ActionDef {
  id: ActionId;
  description: string;
  /** 原始序列匹配（stdin 解析后） */
  keys: string[];
  when: ActionWhen[];
  hint?: string;
}

/**
 * 默认动作表（Grok 把 j/k/L/H 等绑在 ScrollbackFocused；
 * 轻灵用 PgUp/Shift+↑ 等在 append-only 下做 turn 导航）
 */
export const DEFAULT_ACTIONS: ActionDef[] = [
  {
    id: "open_session_picker",
    description: "打开/关闭会话切换器",
    keys: ["\x1c"], // Ctrl+\
    when: ["always"],
    hint: "Ctrl+\\",
  },
  {
    id: "focus_scrollback",
    description: "空输入 Tab → 轮次浏览",
    keys: ["\t"],
    when: ["prompt_focused", "input_empty"],
    hint: "Tab",
  },
  {
    id: "focus_prompt",
    description: "从浏览回输入",
    keys: [" ", "i"],
    when: ["scrollback_focused"],
    hint: "Space",
  },
  {
    id: "overlay_up",
    description: "浮层上一项",
    keys: ["\x1b[A"],
    when: ["overlay_open"],
  },
  {
    id: "overlay_down",
    description: "浮层下一项",
    keys: ["\x1b[B"],
    when: ["overlay_open"],
  },
  {
    id: "overlay_confirm",
    description: "确认浮层选择",
    keys: ["\r", "\n"],
    when: ["overlay_open"],
  },
  {
    id: "overlay_dismiss",
    description: "关闭浮层",
    keys: ["\x1b", "\x03"],
    when: ["overlay_open"],
  },
  {
    id: "viewport_page_up",
    description: "Scrollback 当前轮向上翻页",
    keys: ["\x1b[5~"],
    when: ["scrollback_focused"],
    hint: "PgUp",
  },
  {
    id: "viewport_page_down",
    description: "Scrollback 当前轮向下翻页",
    keys: ["\x1b[6~"],
    when: ["scrollback_focused"],
    hint: "PgDn",
  },
  {
    id: "turn_prev",
    description: "上一用户轮",
    keys: ["\x1b[5~", "\x1b[1;2A"],
    when: ["always"],
    hint: "PgUp / Shift+↑",
  },
  {
    id: "turn_next",
    description: "下一用户轮",
    keys: ["\x1b[6~", "\x1b[1;2B"],
    when: ["always"],
    hint: "PgDn / Shift+↓",
  },
  {
    id: "expand_tools",
    description: "切换工具输出折叠",
    keys: ["\x0f"],
    when: ["prompt_focused"],
    hint: "Ctrl+O",
  },
];

export interface LookupContext {
  focus: "prompt" | "scrollback";
  overlayOpen: boolean;
  inputEmpty: boolean;
}

export function lookupAction(
  seq: string,
  ctx: LookupContext,
  defs: ActionDef[] = DEFAULT_ACTIONS
): ActionId | null {
  for (const def of defs) {
    if (!def.keys.includes(seq)) continue;
    if (matchesWhen(def.when, ctx)) return def.id;
  }
  return null;
}

function matchesWhen(when: ActionWhen[], ctx: LookupContext): boolean {
  return when.every((w) => {
    switch (w) {
      case "always":
        return true;
      case "prompt_focused":
        return ctx.focus === "prompt" && !ctx.overlayOpen;
      case "scrollback_focused":
        return ctx.focus === "scrollback" || ctx.overlayOpen;
      case "overlay_open":
        return ctx.overlayOpen;
      case "input_empty":
        return ctx.inputEmpty;
      default:
        return false;
    }
  });
}

/** Jump 书签：对标 JumpRestore（打开浮层前快照，Esc 恢复） */
export interface JumpRestore {
  focus: "prompt" | "scrollback";
  turnSelected: number;
}

export function captureJumpRestore(
  focus: "prompt" | "scrollback",
  turnSelected: number
): JumpRestore {
  return { focus, turnSelected };
}
