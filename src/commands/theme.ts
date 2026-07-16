import type { SlashCommand } from "./types.js";
import {
  formatThemeStatusLines,
  getActiveThemeId,
  listThemes,
  parseThemeId,
  setTheme,
  type ThemeId,
} from "../tui/theme.js";
import { openOptionPickerOrFallback } from "../tui/option-picker-helpers.js";

function applyThemeNow(
  context: Parameters<SlashCommand["execute"]>[1],
  id: ThemeId
): void {
  setTheme(id);
  // 调色板已更新；必须重画顶栏/输入框，否则用户只看到“写了 env”却无视觉变化
  if (typeof context.repaintChrome === "function") {
    context.repaintChrome();
    return;
  }
  context.writeLine(`🎨 主题 → ${getActiveThemeId()}（非 TUI：仅进程内生效）`);
}

export const themeCommand: SlashCommand = {
  name: "/theme",
  aliases: ["/主题", "/themes"],
  description: "TUI 主题切换器：bamboo · night · mono",
  usage: "/theme [list|bamboo|night|mono|status]",
  category: "local",
  examples: ["/theme", "/theme night", "/theme status"],
  execute: async (args, context) => {
    const sub = (args[0] ?? "").toLowerCase();

    const openPicker = (): boolean =>
      openOptionPickerOrFallback(
        context,
        {
          title: "主题切换 · Theme",
          footerHint: "↑/↓ 选择 · Enter 立即应用并重绘 · Esc 取消",
          selectedId: getActiveThemeId(),
          items: listThemes().map((t) => ({
            id: t.id,
            label: t.id,
            description: t.summary,
            active: t.active,
          })),
          onPick: (item) => {
            const id = parseThemeId(item.id);
            if (!id) return;
            applyThemeNow(context, id);
          },
        },
        () => {
          for (const line of formatThemeStatusLines()) {
            context.writeLine(line);
          }
        }
      );

    if (!sub || sub === "list" || sub === "ls" || sub === "pick" || sub === "ui") {
      openPicker();
      return;
    }
    if (sub === "status" || sub === "状态") {
      for (const line of formatThemeStatusLines()) {
        context.writeLine(line);
      }
      return;
    }
    const id = parseThemeId(sub);
    if (!id) {
      context.writeError(
        `未知主题: ${sub}。可用: ${listThemes()
          .map((t) => t.id)
          .join(", ")}`
      );
      return;
    }
    applyThemeNow(context, id);
  },
};
