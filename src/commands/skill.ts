import { SlashCommand } from "./types.js";
import { runSkill } from "../tools/skill.js";

export const skillCommand: SlashCommand = {
  name: "/skill",
  description: "列出、搜索或读取本地技能",
  usage: "/skill [list|search <query>|name]",
  execute: async (args, context) => {
    const [subcommand, ...rest] = args;
    const normalized = String(subcommand ?? "").trim().toLowerCase();
    const result = normalized === "" || normalized === "list"
      ? await runSkill({ name: "list" })
      : normalized === "search"
        ? await runSkill({ query: rest.join(" ").trim() })
        : await runSkill({ name: args.join(" ").trim() });

    if (result.is_error) {
      context.writeError(result.output);
      return;
    }

    context.writeLine(result.output);
  },
};
