import { buildLocalStorageReport, formatLocalStorageReport } from "../local-storage-report.js";
import { SlashCommand } from "./types.js";

export const storageCommand: SlashCommand = {
  name: "/storage",
  aliases: ["/存储"],
  description: "查看本地数据存储占用",
  usage: "/storage",
  execute: async (_args, context) => {
    const report = await buildLocalStorageReport(context);
    for (const line of formatLocalStorageReport(report)) {
      context.writeLine(line);
    }
  },
};
