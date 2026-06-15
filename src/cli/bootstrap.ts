import * as fs from "fs/promises";
import { execFileSync } from "child_process";
import * as os from "os";
import * as path from "path";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

export type BootstrapBrowserMode = "auto" | "with" | "none";
export type BootstrapProfile = "minimal" | "dev";

export interface BootstrapArgs {
  yes: boolean;
  browser: BootstrapBrowserMode;
  profile: BootstrapProfile;
}

export interface BootstrapReportInput {
  args: BootstrapArgs;
  env?: Record<string, string | undefined>;
  stateDir?: string;
  nodeVersion?: string;
  npmVersion?: string;
}

export interface BootstrapReport {
  profile: BootstrapProfile;
  stateDir: string;
  nodeVersion: string;
  npmVersion: string;
  apiKeyConfigured: boolean;
  browserMode: BootstrapBrowserMode;
  advancedDefaults: {
    dashboard: boolean;
    semanticMemory: boolean;
    dynamicDiscovery: boolean;
  };
  nextSteps: string[];
}

function readNpmVersion(): string {
  try {
    return execFileSync("npm", ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function normalizeProfile(value: string | undefined): BootstrapProfile {
  return value === "dev" ? "dev" : "minimal";
}

export function parseBootstrapArgs(args: string[]): BootstrapArgs {
  return args.reduce<BootstrapArgs>((acc, arg, index) => {
    if (arg === "--yes" || arg === "-y") return { ...acc, yes: true };
    if (arg === "--with-browser") return { ...acc, browser: "with" };
    if (arg === "--no-browser") return { ...acc, browser: "none" };
    if (arg === "--profile") return { ...acc, profile: normalizeProfile(args[index + 1]) };
    if (arg.startsWith("--profile=")) return { ...acc, profile: normalizeProfile(arg.slice("--profile=".length)) };
    return acc;
  }, { yes: false, browser: "auto", profile: "minimal" });
}

function hasApiKey(env: Record<string, string | undefined>): boolean {
  return Boolean(
    env.QLING_LLM_API_KEY?.trim() ||
    env.DEEPSEEK_API_KEY?.trim() ||
    env.OPENAI_API_KEY?.trim()
  );
}

export function buildBootstrapReport(input: BootstrapReportInput): BootstrapReport {
  const env = input.env ?? process.env;
  const stateDir = input.stateDir ?? path.join(os.homedir(), ".qling");
  const apiKeyConfigured = hasApiKey(env);
  const nextSteps = [
    apiKeyConfigured ? "运行 `qling` 进入 TUI。" : "运行 `qling setup` 配置 Provider、模型和 API key。",
    "运行 `qling doctor` 查看本地诊断。",
    "在 TUI 输入 `/` 打开命令面板，输入 `/privacy` 查看本地边界。",
  ];

  if (input.args.browser !== "with") {
    nextSteps.push("如需浏览器抓取能力，重新运行 `qling bootstrap --with-browser`。");
  }

  if (input.args.profile === "dev") {
    nextSteps.push("dev profile 仅提示 dashboard / semantic / discovery 等高级能力；默认不自动开启。");
  }

  return {
    profile: input.args.profile,
    stateDir,
    nodeVersion: input.nodeVersion ?? process.versions.node,
    npmVersion: input.npmVersion ?? "unknown",
    apiKeyConfigured,
    browserMode: input.args.browser,
    advancedDefaults: {
      dashboard: false,
      semanticMemory: false,
      dynamicDiscovery: false,
    },
    nextSteps,
  };
}

export function formatBootstrapReport(report: BootstrapReport): string[] {
  return [
    "",
    "🚀 轻灵 Bootstrap（本机一键启动）",
    "-----------------------------------------",
    `Profile   : ${report.profile}`,
    `Node      : v${report.nodeVersion}`,
    `npm       : ${report.npmVersion}`,
    `State     : ${report.stateDir}`,
    `API key   : ${report.apiKeyConfigured ? "set(redacted)" : "missing"}`,
    `Browser   : ${report.browserMode === "with" ? "install requested" : report.browserMode === "none" ? "skipped" : "optional"}`,
    `Advanced  : dashboard=${report.advancedDefaults.dashboard} semantic=${report.advancedDefaults.semanticMemory} discovery=${report.advancedDefaults.dynamicDiscovery}`,
    "",
    "Next steps:",
    ...report.nextSteps.map((step) => `- ${step}`),
    "-----------------------------------------",
    "说明: bootstrap 只做本机初始化和诊断引导；不上传数据、不调用模型。",
    "",
  ];
}

async function maybeRunSetup(args: BootstrapArgs, report: BootstrapReport, setupRunner: () => Promise<void>): Promise<void> {
  if (report.apiKeyConfigured || args.yes || !input.isTTY) return;
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question("检测到 API key 未配置。是否现在运行 qling setup? (Y/n): ");
    if (answer.trim().toLowerCase() !== "n") {
      await setupRunner();
    }
  } finally {
    rl.close();
  }
}

export async function runBootstrap(
  rawArgs: string[],
  options: {
    setupRunner: () => Promise<void>;
    doctorRunner: () => Promise<string[]>;
    stateDir?: string;
    npmVersion?: string;
  }
): Promise<void> {
  const args = parseBootstrapArgs(rawArgs);
  const stateDir = options.stateDir ?? path.join(os.homedir(), ".qling");
  await fs.mkdir(stateDir, { recursive: true });

  const report = buildBootstrapReport({
    args,
    stateDir,
    npmVersion: options.npmVersion ?? readNpmVersion(),
  });
  console.log(formatBootstrapReport(report).join("\n"));
  await maybeRunSetup(args, report, options.setupRunner);
  console.log((await options.doctorRunner()).join("\n"));
}
