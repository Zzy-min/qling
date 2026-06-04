import { formatSessionExportIndex, listSessionExportFiles, parseSessionExportCount } from "../session-export-index.js";
import { SlashCommand } from "./types.js";

export const exportsCommand: SlashCommand = {
  name: "/exports",
  aliases: ["/导出列表"],
  description: "查看本地 Markdown 会话导出列表",
  usage: "/exports [count]",
  execute: async (args, context) => {
    const report = await listSessionExportFiles(context, {
      count: parseSessionExportCount(args[0]),
    });
    for (const line of formatSessionExportIndex(report)) {
      context.writeLine(line);
    }
  },
};
