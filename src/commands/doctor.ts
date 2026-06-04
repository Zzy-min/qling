import { buildDoctorReport, formatDoctorReport } from "../doctor.js";
import { SlashCommand } from "./types.js";

export const doctorCommand: SlashCommand = {
  name: "/doctor",
  aliases: ["/诊断"],
  description: "运行本地稳定性与数据留存诊断",
  usage: "/doctor",
  execute: async (_args, context) => {
    const report = await buildDoctorReport(context);
    for (const line of formatDoctorReport(report)) {
      context.writeLine(line);
    }
  },
};
