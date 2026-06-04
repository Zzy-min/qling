import { guardConfigFromEnv } from "../config.js";
import { buildLocalHooksReport, formatLocalHooksReport } from "../hooks-report.js";
import { SlashCommand } from "./types.js";

export const hooksCommand: SlashCommand = {
  name: "/hooks",
  aliases: ["/钩子"],
  description: "查看本地 hooks/guard 配置摘要",
  usage: "/hooks",
  execute: async (_args, context) => {
    const report = buildLocalHooksReport(guardConfigFromEnv(process.env));
    for (const line of formatLocalHooksReport(report)) {
      context.writeLine(line);
    }
  },
};
