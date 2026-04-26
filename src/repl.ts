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
        this.rl.close();
        return;
      }

      if (input.trim() === "!reset" || input.trim() === "reset") {
        this.agent.reset();
        console.log("✅ 对话已重置。\n");
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
        // 重置，防止坏状态影响下一轮
        this.agent.reset();
      }
    }
  }
}
