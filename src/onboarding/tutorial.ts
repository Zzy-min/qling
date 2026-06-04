import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { stdin as input, stdout as output } from "process";
import * as readline from "readline/promises";

export async function checkOnboarding(): Promise<void> {
  const onboardedFile = path.join(os.homedir(), ".qingling", ".onboarded");
  
  try {
    await fs.access(onboardedFile);
    return; // Already onboarded
  } catch {
    await startOnboarding();
    await fs.writeFile(onboardedFile, "true", "utf-8");
  }
}

async function startOnboarding() {
  const rl = readline.createInterface({ input, output });

  console.log("\n=========================================");
  console.log("🌬️  欢迎来到 轻灵 (qling) v0.5");
  console.log("=========================================\n");

  console.log("你好！我是轻灵，一个能在本地帮你完成开发任务的智能助手。");
  console.log("我可以帮你写代码、执行 Shell 命令、分析图片，甚至管理复杂的任务流程。");

  await rl.question("\n按回车键开始了解我的核心能力...");

  console.log("\n1. 🛠️  【全能工具箱】");
  console.log("   - 我可以使用 `bash` 执行任何命令。");
  console.log("   - 我可以使用 `read`/`write` 读写文件。");
  console.log("   - 我可以使用 `vision_analyze` 解析 UI 界面。");

  console.log("\n2. 🧠  【深度记忆】");
  console.log("   - 我会自动将重要的发现转化为“长期记忆”，并在后续对话中回想起来。");

  await rl.question("\n按回车键了解高效交互方式...");

  console.log("\n3. ⚡  【快捷指令】");
  console.log("   - 输入 `/help` 查看所有本地快捷指令。");
  console.log("   - 输入 `/clear` 重置当前会话，开启新话题。");

  console.log("\n4. 📊  【白盒观测】");
  console.log("   - 输入 `/dashboard` 即可获取本地 Web 观测台的地址。");

  console.log("\n=========================================");
  console.log("教学完成！现在开始您的 Agent 之旅吧。");
  console.log("=========================================\n");

  await rl.question("按回车键进入终端...");
  rl.close();
}
