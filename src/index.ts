#!/usr/bin/env node
// ============================================================
// 轻灵 - CLI 入口
// 使用方式:
//   单次任务: node dist/index.js "你的任务"
//   交互模式: node dist/index.js --repl
//   交互模式: node dist/index.js -r
// ============================================================

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

// 从当前模块向上查找 .env（兼容 npm link 场景）
function findEnvPath(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const envPath = path.join(dir, ".env");
    if (fs.existsSync(envPath)) return envPath;
    const parent = path.dirname(dir);
    if (parent === dir) break; // 到达根目录
    dir = parent;
  }
  return path.join(process.cwd(), ".env"); // fallback
}

dotenv.config({ path: findEnvPath() });

import { AgentLoop } from "./agent-loop.js";
import { Repl } from "./repl.js";
import { StreamingREPL } from "./tui/streaming-repl.js";

async function main() {
  const args = process.argv.slice(2);

  // TUI 交互模式（流式输出）
  if (args.includes("--tui") || args.includes("-t")) {
    const repl = new StreamingREPL();
    repl.start();
    return;
  }

  // 交互模式
  if (args.includes("--repl") || args.includes("-r")) {
    const repl = new Repl();
    await repl.start();
    return;
  }

  const task = args.join(" ");

  if (!task) {
    console.log(`
╔══════════════════════════════════════╗
║          轻灵 (QingLing) v0.1     ║
║     通用 CLI Agent - 轻量、敏捷     ║
╚══════════════════════════════════════╝

用法:
  node dist/index.js "你的任务"       # 单次任务
  node dist/index.js --repl          # 交互模式（多轮对话）
  node dist/index.js -r               # 同上

交互模式:
  输入任务 → 回车执行
  q / quit / exit → 退出
  !reset → 重置对话

工具: bash | read | write | todo | skill

环境变量 (.env):
  DEEPSEEK_API_KEY=***
`);
    process.exit(0);
  }

  console.log(`\n🎋 轻灵正在思考...\n`);

  try {
    const agent = new AgentLoop();
    agent.addUserMessage(task);
    const response = await agent.run();
    console.log(response);
  } catch (err) {
    console.error("❌ 运行出错:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
