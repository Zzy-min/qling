import { buildStatusLine } from "../statusline.js";
import { SlashCommand } from "./types.js";
import { formatInfoCard } from "../tui/info-card.js";

export const statuslineCommand: SlashCommand = {
  name: "/statusline",
  aliases: ["/状态线"],
  description: "查看或切换 prompt 前的本地状态线",
  usage: "/statusline [on|off|status]",
  execute: async (args, context) => {
    const sub = (args[0] ?? "status").toLowerCase();
    if (sub === "on") {
      context.statusLine?.setEnabled(true);
      context.writeLine("");
      context.writeLine("◎ statusline on");
      context.writeLine("说明: 已开启 prompt 前状态线。");
      context.writeLine("");
      return;
    }
    if (sub === "off") {
      context.statusLine?.setEnabled(false);
      context.writeLine("");
      context.writeLine("◎ statusline off");
      context.writeLine("说明: 已关闭 prompt 前状态线。");
      context.writeLine("");
      return;
    }
    if (sub !== "status") {
      context.writeError("❌ 用法: /statusline [on|off|status]");
      return;
    }

    const line = context.statusLine?.getLine
      ? await context.statusLine.getLine()
      : await buildStatusLine(context);
    const plain = String(line ?? "").replace(/\x1b\[[0-9;]*m/g, "");
    const width = Math.max(36, Math.min(84, (process.stdout.columns || 100) - 4));
    const card = formatInfoCard({
      title: "◎ statusline",
      rows: [
        { label: "状态线", value: plain || "(空)" },
        { label: "启用", value: String(context.statusLine?.enabled ?? true) },
      ],
      footer: "切换: /statusline on | off",
      width,
    });
    context.writeLine("");
    for (const cardLine of card) context.writeLine(cardLine);
    context.writeLine("");
  },
};
