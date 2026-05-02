import { SlashCommand } from "./types.js";
import { AgentLoop } from "../agent-loop.js";

export const skillCommand: SlashCommand = {
  name: "/skill",
  description: "列出或挂载可用技能",
  usage: "/skill [name]",
  execute: async (args, agentLoop) => {
    const registry = (agentLoop as any).getDiscoveryRegistry();
    if (!registry) {
      console.log("❌ 动态发现注册表不可用。");
      return;
    }

    if (args.length === 0) {
      const items = registry.getAllItems();
      console.log("\n📦 【可用技能与插件】");
      console.log("-----------------------------------------");
      if (items.length === 0) {
        console.log("(无)");
      } else {
        items.forEach((it: any) => {
          console.log(`- [${it.manifest.type}] ${it.manifest.name} v${it.manifest.version} (${it.status})`);
        });
      }
      console.log("-----------------------------------------\n");
    } else {
      const name = args[0];
      // 这里的逻辑可以是对接 agentLoop 的逻辑，让它在下一轮对话中优先考虑此技能
      console.log(`\n💡 已标记技能 "${name}" 为高优先级（模拟动作）。`);
    }
  },
};
