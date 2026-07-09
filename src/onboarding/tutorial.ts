import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { stdin as input } from "process";

export interface OnboardingStep {
  id: string;
  title: string;
  detail: string;
  example?: string;
}

export interface OnboardingCardOptions {
  /** 产品显示名 */
  productName?: string;
  /** 是否强调 API key 配置 */
  needSetup?: boolean;
}

/**
 * 首次启动 3 步任务（纯数据，可单测）。
 */
export function buildOnboardingSteps(options: OnboardingCardOptions = {}): OnboardingStep[] {
  const steps: OnboardingStep[] = [
    {
      id: "task",
      title: "发一条真实任务",
      detail: "直接输入自然语言任务，让 Agent 使用本机工具完成。",
      example: "分析这个仓库的结构",
    },
    {
      id: "slash",
      title: "打开本地控制面",
      detail: "输入 / 打开命令面板；Tab 补全；方向键选择。",
      example: "/help  或  /statusline",
    },
    {
      id: "doctor",
      title: "检查环境与隐私边界",
      detail: "确认配置、状态目录与数据留存路径。",
      example: "/doctor   然后   /privacy",
    },
  ];

  if (options.needSetup) {
    steps.unshift({
      id: "setup",
      title: "先完成 LLM 配置",
      detail: "运行 setup 选择 Provider/Model；API key 写入系统环境变量，勿写入 .env。",
      example: "qling setup",
    });
  }

  return steps;
}

/**
 * 格式化首次启动卡片（不调用模型、不上传）。
 */
export function formatOnboardingCard(options: OnboardingCardOptions = {}): string[] {
  const product = options.productName?.trim() || "轻灵 Qling";
  const steps = buildOnboardingSteps(options);
  const lines = [
    "",
    `${product} · 本地工作台`,
    "-----------------------------------------",
    "首次使用 · 按下面步骤开始（本地引导，不调用模型）:",
  ];

  steps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step.title}`);
    lines.push(`   ${step.detail}`);
    if (step.example) {
      lines.push(`   例: ${step.example}`);
    }
  });

  lines.push("-----------------------------------------");
  lines.push("提示: 完成后可用 /expand、/plan、/model list 继续探索。");
  lines.push("安装与分发: 见 docs/install.md 与 README.en.md");
  lines.push("");
  return lines;
}

export function resolveOnboardedPath(stateDir: string): string {
  return path.join(path.resolve(stateDir), ".onboarded");
}

export async function hasCompletedOnboarding(stateDir: string): Promise<boolean> {
  try {
    await fs.access(resolveOnboardedPath(stateDir));
    return true;
  } catch {
    return false;
  }
}

export async function markOnboardingComplete(stateDir: string): Promise<void> {
  await fs.mkdir(path.resolve(stateDir), { recursive: true });
  await fs.writeFile(resolveOnboardedPath(stateDir), new Date().toISOString() + "\n", "utf-8");
}

export async function checkOnboarding(
  options: {
    stateDir?: string | null;
    needSetup?: boolean;
    /** 强制展示（测试用） */
    force?: boolean;
    write?: (line: string) => void;
  } = {}
): Promise<{ shown: boolean }> {
  if (!options.force && !input.isTTY) {
    return { shown: false };
  }

  const stateDir = options.stateDir ? path.resolve(options.stateDir) : path.join(os.homedir(), ".qling");

  if (!options.force && (await hasCompletedOnboarding(stateDir))) {
    return { shown: false };
  }

  const write = options.write ?? ((line: string) => console.log(line));
  for (const line of formatOnboardingCard({ needSetup: options.needSetup })) {
    write(line);
  }

  if (!options.force) {
    await markOnboardingComplete(stateDir);
  }
  return { shown: true };
}
