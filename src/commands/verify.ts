import { SlashCommand } from "./types.js";

export const verifyCommand: SlashCommand = {
  name: "/verify",
  aliases: ["/验证"],
  description: "配置与运行构建/测试验证与自动自愈",
  usage: "/verify status | set <command> | clear | run",
  category: "local",
  argumentHint: "status | set <command> | clear | run",
  examples: [
    "/verify status",
    "/verify set \"npm run build\"",
    "/verify clear",
    "/verify run"
  ],
  execute: async (args, context) => {
    const agentLoop = context.agentLoop as any;
    if (!agentLoop || typeof agentLoop.getVerificationCommand !== "function") {
      context.writeError("❌ 当前 AgentLoop 不支持自动验证。");
      return;
    }

    if (args.length === 0) {
      context.writeError("❌ 用法: /verify status | set <command> | clear | run");
      return;
    }

    const sub = args[0].toLowerCase();
    switch (sub) {
      case "status": {
        const cmd = agentLoop.getVerificationCommand();
        context.writeLine("");
        context.writeLine("🔍 【构建/测试自动验证状态】");
        context.writeLine("-----------------------------------------");
        if (cmd) {
          context.writeLine(`当前验证命令 : ${cmd}`);
          context.writeLine(`自动恢复状态 : 已开启 (同因最多 2 次，策略预算 4 次)`);
        } else {
          context.writeLine("当前验证命令 : (未设置)");
          context.writeLine("自动恢复状态 : 已关闭");
        }
        context.writeLine("-----------------------------------------");
        context.writeLine("");
        break;
      }
      case "set": {
        if (args.length < 2) {
          context.writeError("❌ 用法: /verify set <command>");
          return;
        }
        let cmd = args.slice(1).join(" ");
        if ((cmd.startsWith('"') && cmd.endsWith('"')) || (cmd.startsWith("'") && cmd.endsWith("'"))) {
          cmd = cmd.slice(1, -1);
        }
        await agentLoop.setVerificationCommand(cmd);
        context.writeLine(`\n✅ 自动验证命令设置成功: "${cmd}"，自愈开启。\n`);
        break;
      }
      case "clear": {
        await agentLoop.setVerificationCommand(null);
        context.writeLine("\n🧹 自动验证命令已清除，自愈关闭。\n");
        break;
      }
      case "run": {
        const cmd = agentLoop.getVerificationCommand();
        if (!cmd) {
          context.writeError("❌ 当前未配置任何验证命令。使用 '/verify set <command>' 进行配置。");
          return;
        }
        context.writeLine(`\n🏃 正在手动运行验证命令: "${cmd}"...`);
        const { code, stdout, stderr } = await agentLoop.runVerificationCommand(cmd);
        context.writeLine(`\n[stdout]\n${stdout}`);
        if (stderr) {
          context.writeLine(`\n[stderr]\n${stderr}`);
        }
        if (code === 0) {
          context.writeLine("\n✅ 验证通过！");
        } else {
          context.writeError(`\n❌ 验证失败！退出码: ${code}`);
        }
        context.writeLine("");
        break;
      }
      default:
        context.writeError(`❌ 未知子命令: ${sub}。用法: /verify status | set <command> | clear | run`);
    }
  },
};
