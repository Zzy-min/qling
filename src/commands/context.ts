import { buildContextReport, formatContextReport } from "../context-report.js";
import { SlashCommand } from "./types.js";

export const contextCommand: SlashCommand = {
  name: "/context",
  aliases: ["/上下文"],
  description: "查看当前会话上下文占用与本地留存路径",
  usage: "/context",
  execute: async (_args, context) => {
    const report = await buildContextReport(context);
    for (const line of formatContextReport(report)) {
      context.writeLine(line);
    }
  },
};
