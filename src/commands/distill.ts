import { homedir } from "os";
import { join } from "path";
import {
  formatLocalMemoryPracticesReport,
  listLocalMemoryPractices,
  parseMemoryReportCount,
} from "../memory-report.js";
import type { SlashCommandContext } from "./runtime.js";
import { SlashCommand } from "./types.js";

function resolveStateDir(context: SlashCommandContext): string {
  const agentLoop = context.agentLoop as any;
  return agentLoop.getRuntimeRootDir?.()
    || process.env.QLING_FILE_STATE_DIR
    || join(context.homeDir ?? homedir(), ".qling");
}

export const distillCommand: SlashCommand = {
  name: "/distill",
  aliases: ["/蒸馏", "/经验"],
  description: "查看本地蒸馏实践摘要",
  usage: "/distill [count]",
  execute: async (args, context) => {
    const report = await listLocalMemoryPractices(resolveStateDir(context), {
      count: parseMemoryReportCount(args[0]),
    });
    for (const line of formatLocalMemoryPracticesReport(report)) {
      context.writeLine(line);
    }
  },
};
