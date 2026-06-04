import { SlashCommand } from "./types.js";

export const skillCommand: SlashCommand = {
  name: "/skill",
  description: "列出或挂载可用技能",
  usage: "/skill [name]",
  execute: async (args, context) => {
    const registry = (context.agentLoop as any).getDiscoveryRegistry();
    if (!registry) {
      context.writeError("❌ 动态发现注册表不可用。");
      return;
    }

    if (args.length === 0) {
      const items = registry.getAllItems();
      context.writeLine("");
      context.writeLine("📦 【可用技能与插件】");
      context.writeLine("-----------------------------------------");
      if (items.length === 0) {
        context.writeLine("(无)");
      } else {
        items.forEach((it: any) => {
          context.writeLine(`- [${it.manifest.type}] ${it.manifest.name} v${it.manifest.version} (${it.status})`);
        });
      }
      context.writeLine("-----------------------------------------");
      context.writeLine("");
    } else {
      const name = args[0];
      // 这里的逻辑可以是对接 agentLoop 的逻辑，让它在下一轮对话中优先考虑此技能
      context.writeLine("");
      context.writeLine(`💡 已标记技能 "${name}" 为高优先级（模拟动作）。`);
    }
  },
};
