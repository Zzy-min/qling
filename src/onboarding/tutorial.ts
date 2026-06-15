import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { stdin as input } from "process";

export async function checkOnboarding(options: { stateDir?: string | null } = {}): Promise<void> {
  if (!input.isTTY) {
    return;
  }

  const stateDir = options.stateDir ? path.resolve(options.stateDir) : path.join(os.homedir(), ".qling");
  const onboardedFile = path.join(stateDir, ".onboarded");

  try {
    await fs.access(onboardedFile);
    return; // Already onboarded
  } catch {
    await startOnboarding();
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(onboardedFile, "true", "utf-8");
  }
}

async function startOnboarding() {
  console.log("\n轻灵 Qling 本地工作台");
  console.log("-----------------------------------------");
  console.log("3 步开始:");
  console.log("1. 直接输入任务，例如：分析这个仓库");
  console.log("2. 输入 `/` 打开命令面板，Tab 补全");
  console.log("3. 输入 `/doctor` 检查本地环境，`/privacy` 查看数据边界");
  console.log("-----------------------------------------\n");
}
