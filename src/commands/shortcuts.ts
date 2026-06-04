import { SlashCommand } from "./types.js";
import { SHORTCUT_LINES } from "../shortcuts.js";

export const shortcutsCommand: SlashCommand = {
  name: "/shortcuts",
  aliases: ["/快捷键"],
  description: "查看 TUI 快捷键",
  usage: "/shortcuts",
  execute: async (_args, context) => {
    for (const line of SHORTCUT_LINES) {
      context.writeLine(line);
    }
  },
};
