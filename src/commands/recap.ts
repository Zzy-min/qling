import { buildLocalRecap, resolveRecapLimit } from "../recap.js";
import { SlashCommand } from "./types.js";

export const recapCommand: SlashCommand = {
  name: "/recap",
  aliases: ["/回顾"],
  description: "查看当前本地会话回顾",
  usage: "/recap [count]",
  execute: async (args, context) => {
    const limit = resolveRecapLimit(args[0]);
    context.writeLine(await buildLocalRecap(context, limit));
  },
};
