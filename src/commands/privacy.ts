import { buildPrivacyReport, formatPrivacyReport } from "../privacy-report.js";
import { SlashCommand } from "./types.js";

export const privacyCommand: SlashCommand = {
  name: "/privacy",
  aliases: ["/隐私"],
  description: "查看本地数据留存路径与边界说明",
  usage: "/privacy",
  execute: async (_args, context) => {
    const report = await buildPrivacyReport(context);
    for (const line of formatPrivacyReport(report)) {
      context.writeLine(line);
    }
  },
};
