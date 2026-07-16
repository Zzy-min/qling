// ============================================================
// 命令侧：优先 TUI 切换器，否则文本列表（无叠层副作用）
// ============================================================

import type { SlashCommandContext } from "../slash-context.js";
import type { OptionPickerItem, OptionPickerSpec } from "./overlay-panel.js";

export type { OptionPickerItem, OptionPickerSpec };

/**
 * 打开通用切换器；若无 TUI hook 则执行 fallback 文本输出。
 * 返回 true 表示已用切换器承接，调用方勿再 writeLine 堆列表。
 */
export function openOptionPickerOrFallback(
  context: SlashCommandContext,
  spec: OptionPickerSpec,
  fallback: () => void
): boolean {
  if (typeof context.openOptionPicker === "function") {
    context.openOptionPicker(spec);
    return true;
  }
  fallback();
  return false;
}
