// ============================================================
// 轻灵 - 交互模式 REPL
// 多轮对话，不用每次都重开
// ============================================================

import * as readline from "readline";
import { AgentLoop } from "./agent-loop.js";

export class Repl {
  private agent: AgentLoop;
  private rl: readline.Interface;

  constructor(agent?: AgentLoop) {
    this.agent = agent ?? new AgentLoop();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async start(): Promise<void> {
    console.log(`
╔══════════════════════════════════════════╗
║         🌬️ 轻灵 REPL 模式               ║
║   输入任务，回车执行。输入 q 退出。       ║
║   输入 !reset 重置对话。                 ║
║   输入 !save [name] 保存会话。           ║
║   输入 !load [name] 恢复会话。           ║
║   输入 !sessions 查看已保存会话。         ║
╚══════════════════════════════════════════╝
`);
    this.loop();
  }

  private async loop(): Promise<void> {
    const prompt = () =>
      new Promise<string>((resolve) => {
        this.rl.question("🎋 > ", (answer) => resolve(answer));
      });

    while (true) {
      const input = await prompt();

      if (input.trim() === "q" || input.trim() === "quit" || input.trim() === "exit") {
        console.log("👋 再见！");
        try {
          await this.agent.shutdown();
        } catch {
          // ignore shutdown cleanup failures in REPL exit path
        }
        this.rl.close();
        process.stdin.pause();
        return;
      }

      if (input.trim() === "!reset" || input.trim() === "reset") {
        this.agent.reset();
        console.log("✅ 对话已重置。\n");
        continue;
      }

      if (input.trim() === "!save" || input.trim().startsWith("!save ")) {
        const name = input.trim().replace(/^!save\s*/, "") || undefined;
        const file = await this.agent.saveSession(name);
        console.log(`💾 会话已保存: ${file}\n`);
        continue;
      }

      if (input.trim() === "!load" || input.trim().startsWith("!load ")) {
        const name = input.trim().replace(/^!load\s*/, "");
        if (!name) {
          const sessions = await this.agent.listSessions();
          if (sessions.length === 0) {
            console.log("📭 没有已保存的会话。\n");
          } else {
            console.log("📂 已保存的会话:\n" + sessions.map((s, i) => `  ${i + 1}. ${s}`).join("\n") + "\n");
          }
        } else {
          const ok = await this.agent.loadSession(name);
          console.log(ok ? `📂 会话已恢复: ${name}\n` : `❌ 找不到会话: ${name}\n`);
        }
        continue;
      }

      if (input.trim() === "!sessions" || input.trim() === "!ls") {
        const sessions = await this.agent.listSessions();
        if (sessions.length === 0) {
          console.log("📭 没有已保存的会话。\n");
        } else {
          console.log("📂 已保存的会话:\n" + sessions.map((s, i) => `  ${i + 1}. ${s}`).join("\n") + "\n");
        }
        continue;
      }

      if (!input.trim()) {
        continue;
      }

      console.log("\n🎋 轻灵正在思考...\n");

      try {
        this.agent.addUserMessage(input);
        const response = await this.agent.run();
        console.log(`\n${response}\n`);
      } catch (err) {
        console.error(`\n❌ 出错: ${err instanceof Error ? err.message : String(err)}\n`);
        console.log("💡 输入 !reset 重置对话，或继续输入新任务。\n");
      }
    }
  }
}
