import { writeSessionExport } from "../session-export.js";
import { SlashCommand } from "./types.js";

export const exportCommand: SlashCommand = {
  name: "/export",
  aliases: ["/导出"],
  description: "将当前会话导出为本地 Markdown",
  usage: "/export",
  execute: async (_args, context) => {
    const result = await writeSessionExport(context);
    context.writeLine("");
    context.writeLine("📄 会话已导出");
    context.writeLine("-----------------------------------------");
    context.writeLine(`Path      : ${result.path}`);
    context.writeLine(`Messages  : ${result.messageCount}`);
    context.writeLine("说明      : 导出只读取本地会话快照，不调用模型、不联网。");
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
