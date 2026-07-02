import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";

import { SlashCommand } from "./types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_MODELS = [
  "deepseek-chat",
  "qwen-plus",
  "glm-4",
  "moonshot-v1-8k",
  "gpt-4o",
  "llama3",
];

function workspaceOf(context: any): string {
  return context.workspaceDir || context.agentLoop?.getWorkspaceDir?.() || process.cwd();
}

function formatBoundary(command: string, replacement?: string): string[] {
  return [
    "",
    `⛔ ${command} 在轻灵本地不可用`,
    "-----------------------------------------",
    "原因      : 该命令依赖 Claude 账号、云端服务、桌面/移动端或平台专属能力。",
    replacement ? `替代      : ${replacement}` : "替代      : 使用 /help 查看轻灵本地可用命令。",
    "边界      : 这是本地说明；不调用模型、不联网、不上传、不修改配置。",
    "-----------------------------------------",
    "",
  ];
}

function createUnavailableCommand(
  name: string,
  description: string,
  replacement?: string,
  aliases: string[] = [],
  argumentHint = "",
): SlashCommand {
  return {
    name,
    aliases,
    description,
    usage: `${name}${argumentHint ? ` ${argumentHint}` : ""}`,
    category: "cloud",
    argumentHint,
    availability: "unsupported",
    claudeCompatibleName: name,
    execute: async (_args, context) => {
      for (const line of formatBoundary(name, replacement)) context.writeLine(line);
    },
  };
}

export const usageCommand: SlashCommand = {
  name: "/usage",
  aliases: ["/cost", "/stats"],
  description: "查看本地 token 与上下文预算使用情况",
  usage: "/usage",
  category: "session",
  availability: "local",
  claudeCompatibleName: "/usage",
  execute: async (_args, context) => {
    const stats = typeof (context.agentLoop as any).getSessionStats === "function"
      ? await (context.agentLoop as any).getSessionStats()
      : { sessionId: "unknown", turnCount: 0, tokens: 0, tokenSource: "unknown", compactions: 0 };
    const maxTokens = Number(process.env.QLING_MAX_TOKEN_BUDGET ?? process.env.QLING_RUNTIME_MAX_TOKEN_BUDGET ?? "120000");
    const tokens = Math.max(0, Number(stats.tokens ?? 0));
    const pct = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.round((tokens / maxTokens) * 100) : null;

    context.writeLine("");
    context.writeLine("📈 【本地用量】");
    context.writeLine("-----------------------------------------");
    context.writeLine(`Session   : ${stats.sessionId ?? "unknown"}`);
    context.writeLine(`Turns     : ${Number(stats.turnCount ?? 0)}`);
    context.writeLine(`Tokens    : ${tokens.toLocaleString()}`);
    context.writeLine(`Source    : ${stats.tokenSource ?? "unknown"}`);
    context.writeLine(`Context   : ${pct === null ? "unknown" : `${pct}% of ${maxTokens.toLocaleString()}`}`);
    context.writeLine(`Compacts  : ${Number(stats.compactions ?? 0)}`);
    context.writeLine("边界      : provider usage 优先；缺失时使用本地估算，不代表最终账单。");
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};

export const modelCommand: SlashCommand = {
  name: "/model",
  description: "查看或切换当前会话模型",
  usage: "/model [model]",
  category: "session",
  argumentHint: "[model]",
  availability: "local",
  claudeCompatibleName: "/model",
  execute: async (args, context) => {
    const current = typeof (context.agentLoop as any).getModel === "function"
      ? (context.agentLoop as any).getModel()
      : process.env.QLING_LLM_MODEL || "unknown";
    const next = args.join(" ").trim();

    context.writeLine("");
    context.writeLine("🤖 【模型】");
    context.writeLine("-----------------------------------------");
    if (!next) {
      context.writeLine(`当前模型 : ${current}`);
      context.writeLine(`候选     : ${DEFAULT_MODELS.join(", ")}`);
      context.writeLine("用法     : /model <model>");
      context.writeLine("边界     : 不写配置文件；带参数时只切换当前进程会话。");
    } else if (typeof (context.agentLoop as any).setModel !== "function") {
      context.writeError("❌ 当前 AgentLoop 不支持 session 级模型切换。");
    } else {
      (context.agentLoop as any).setModel(next);
      process.env.QLING_LLM_MODEL = next;
      await context.onModelChanged?.(next);
      context.writeLine(`已切换   : ${current} -> ${next}`);
      context.writeLine("范围     : 仅当前会话/当前进程，不写入默认配置。");
    }
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};

export const planCommand: SlashCommand = {
  name: "/plan",
  description: "把下一步请求转为普通会话计划草稿",
  usage: "/plan [description]",
  category: "session",
  argumentHint: "[description]",
  availability: "local",
  claudeCompatibleName: "/plan",
  execute: async (args, context) => {
    const description = args.join(" ").trim() || "请基于当前上下文先给出实施计划，不要直接修改文件。";
    const prompt = [
      "请先给出计划，再等待用户确认或继续指令。",
      "这是轻灵普通会话计划请求，不进入 Codex Plan Mode。",
      "",
      `任务: ${description}`,
    ].join("\n");
    if (!context.setImmediatePrompt) {
      context.writeError("❌ 当前会话不支持排队计划 prompt。");
      return;
    }
    context.setImmediatePrompt(prompt);
    context.writeLine("");
    context.writeLine("🧭 已创建普通会话计划请求");
    context.writeLine("-----------------------------------------");
    context.writeLine(`任务     : ${description}`);
    context.writeLine("边界     : 将作为下一条普通 prompt 执行；不改变系统 Plan Mode。");
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};

export const diffCommand: SlashCommand = {
  name: "/diff",
  description: "查看当前工作区 Git 变更摘要（支持 /diff full 查看完整 diff）",
  usage: "/diff [full]",
  category: "git",
  availability: "local",
  claudeCompatibleName: "/diff",
  execute: async (args, context) => {
    const cwd = workspaceOf(context);
    const showFull = args.includes("full") || args.includes("--full");
    context.writeLine("");
    context.writeLine("🧾 【Git Diff】");
    context.writeLine("-----------------------------------------");
    try {
      const status = await execFileAsync("git", ["status", "--short"], { cwd, timeout: 10_000 });
      const stat = await execFileAsync("git", ["diff", "--stat"], { cwd, timeout: 10_000 });
      const statusText = String(status.stdout || "").trim();
      const statText = String(stat.stdout || "").trim();
      context.writeLine(`Workspace : ${cwd}`);
      context.writeLine(statusText ? statusText : "(working tree clean)");
      if (statText) {
        context.writeLine("");
        context.writeLine(statText);
      }
      if (showFull) {
        try {
          const full = await execFileAsync("git", ["diff"], { cwd, timeout: 15_000 });
          const fullText = String(full.stdout || "").trim();
          if (fullText) {
            context.writeLine("\n--- full diff (truncated if long) ---");
            context.writeLine(fullText.slice(0, 2000) + (fullText.length > 2000 ? "\n... (truncated)" : ""));
          }
        } catch {}
      }
      context.writeLine("边界      : 只读 git status/diff，不修改文件。使用 /diff full 查看内容。");
    } catch {
      context.writeLine(`Workspace : ${cwd}`);
      context.writeLine("状态      : 非 Git 仓库或 Git 不可用。");
      context.writeLine("边界      : 未执行任何修改。");
    }
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};

export const commitCommand: SlashCommand = {
  name: "/commit",
  description: "安全提交当前 Git 变更（本地操作，自动 add -A）",
  usage: "/commit [message]",
  category: "git",
  availability: "local",
  claudeCompatibleName: "/commit",
  execute: async (args, context) => {
    const cwd = workspaceOf(context);
    const message = args.join(" ").trim() || "chore: qling agent update";
    context.writeLine("");
    context.writeLine("🧾 【Git Commit】");
    context.writeLine("-----------------------------------------");
    try {
      const status = await execFileAsync("git", ["status", "--porcelain"], { cwd, timeout: 5000 });
      if (!String(status.stdout || "").trim()) {
        context.writeLine("工作区干净，无需提交。");
        context.writeLine("边界      : 只读/本地 git 操作。");
        context.writeLine("-----------------------------------------");
        context.writeLine("");
        return;
      }
      await execFileAsync("git", ["add", "-A"], { cwd, timeout: 10000 });
      const res = await execFileAsync("git", ["commit", "-m", message], { cwd, timeout: 10000 });
      context.writeLine("✅ 提交成功");
      context.writeLine(String(res.stdout || res.stderr || "").trim() || "Committed.");
    } catch (err: any) {
      context.writeLine("❌ 提交失败: " + (err.message || String(err)));
      context.writeLine("提示: 确保在 git repo 内，无冲突，message 有效。");
    }
    context.writeLine("边界      : 本地 git 操作；危险命令仍受 guard 保护（如果通过 bash 工具）。");
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};

async function writeClipboardFallback(text: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("clipboard fallback only implemented for Windows");
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell", ["-NoProfile", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"], {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `Set-Clipboard exited with ${code}`));
    });
    child.stdin.end(text);
  });
}

export const copyCommand: SlashCommand = {
  name: "/copy",
  description: "复制最近第 N 条 assistant 回复",
  usage: "/copy [N]",
  category: "session",
  argumentHint: "[N]",
  availability: "local",
  claudeCompatibleName: "/copy",
  execute: async (args, context) => {
    const n = Math.max(1, Number.parseInt(args[0] ?? "1", 10) || 1);
    const messages = typeof (context.agentLoop as any).getMessagesSnapshot === "function"
      ? (context.agentLoop as any).getMessagesSnapshot()
      : [];
    const replies = messages.filter((message: any) => message?.role === "assistant" && String(message.content ?? "").trim());
    const selected = replies[replies.length - n];
    if (!selected) {
      context.writeError("❌ 没有可复制的 assistant 回复。");
      return;
    }
    const content = String(selected.content);
    try {
      if (context.writeClipboard) await context.writeClipboard(content);
      else await writeClipboardFallback(content);
      context.writeLine(`✅ 已复制第 ${n} 条最近 assistant 回复 (${content.length} chars)。`);
    } catch (err) {
      context.writeError(`❌ 剪贴板不可用: ${err instanceof Error ? err.message : String(err)}`);
      context.writeLine(content.slice(0, 1000));
    }
  },
};

function formatGuide(workspace: string): string {
  return [
    "# 轻灵项目指南",
    "",
    "## 项目边界",
    "- 本文件由 `/init` 生成，用于记录本仓库的本地协作规则。",
    "- 轻灵优先 local-first：命令、记忆、会话和诊断默认留在本机。",
    "",
    "## 常用命令",
    "- `/help` 查看本地 slash 命令。",
    "- `/context` 查看上下文占用。",
    "- `/diff` 查看 Git 变更摘要。",
    "- `/checkpoint` 保存本地恢复点。",
    "",
    `Workspace: ${workspace}`,
    "",
  ].join("\n");
}

export const initCommand: SlashCommand = {
  name: "/init",
  description: "生成轻灵本地项目指南",
  usage: "/init [--force]",
  category: "core",
  argumentHint: "[--force]",
  availability: "local",
  claudeCompatibleName: "/init",
  execute: async (args, context) => {
    const force = args.includes("--force");
    const cwd = workspaceOf(context);
    const target = join(cwd, "AGENTS.md");
    if (existsSync(target) && !force) {
      context.writeError("❌ AGENTS.md 已存在；如需覆盖请使用 /init --force。");
      return;
    }
    await mkdir(cwd, { recursive: true });
    await writeFile(target, formatGuide(cwd), "utf-8");
    context.writeLine("");
    context.writeLine("📝 已生成轻灵本地项目指南");
    context.writeLine("-----------------------------------------");
    context.writeLine(`Path      : ${target}`);
    context.writeLine("边界      : 只写入本地 AGENTS.md；不调用模型、不联网。");
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};

export const rewindCommand: SlashCommand = {
  name: "/rewind",
  aliases: ["/undo"],
  description: "查看可恢复会话点，不自动回滚代码",
  usage: "/rewind",
  category: "session",
  availability: "local",
  claudeCompatibleName: "/rewind",
  execute: async (_args, context) => {
    const sessions = context.listSavedSessions
      ? await context.listSavedSessions()
      : typeof (context.agentLoop as any).listSessionsDetailed === "function"
        ? await (context.agentLoop as any).listSessionsDetailed()
        : [];
    context.writeLine("");
    context.writeLine("⏪ 【可恢复点】");
    context.writeLine("-----------------------------------------");
    if (!sessions.length) {
      context.writeLine("(无)");
    } else {
      for (const session of sessions.slice(0, 8)) {
        context.writeLine(`- ${session.name} | ${session.sessionId} | turns=${session.turnCount}`);
      }
    }
    context.writeLine("下一步    : 使用 /resume <session> 恢复会话，或 /checkpoint 保存新恢复点。");
    context.writeLine("边界      : 不自动回滚代码、不修改文件。");
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};

export const unavailableClaudeCommands: SlashCommand[] = [
  createUnavailableCommand("/login", "Claude 账号登录入口", "/config 查看本地 provider 配置"),
  createUnavailableCommand("/logout", "Claude 账号退出入口", "/config 查看本地 provider 配置"),
  createUnavailableCommand("/desktop", "打开 Claude Desktop 会话", "/export 导出当前会话", ["/app"]),
  createUnavailableCommand("/mobile", "显示 Claude 移动端二维码", "/sessions 与 /resume 在本地恢复会话", ["/ios", "/android"]),
  createUnavailableCommand("/teleport", "拉取 Claude Web 会话", "/resume 恢复本地会话", ["/tp"]),
  createUnavailableCommand("/upgrade", "打开 Claude 订阅升级页"),
  createUnavailableCommand("/privacy-settings", "Claude 账号隐私设置", "/privacy 查看轻灵本地隐私边界"),
  createUnavailableCommand("/feedback", "提交 Claude 反馈", "/doctor 先做本地诊断", ["/bug", "/share"], "[report]"),
  createUnavailableCommand("/install-github-app", "安装 Claude GitHub App"),
  createUnavailableCommand("/web-setup", "连接 Claude Web GitHub"),
  createUnavailableCommand("/schedule", "创建 Claude 云端 routine", "/loop daemon 使用本地持久任务", ["/routines"], "[description]"),
  createUnavailableCommand("/radio", "打开 Claude FM"),
  createUnavailableCommand("/stickers", "订购 Claude Code stickers"),
  createUnavailableCommand("/background", "Claude cloud/background agent", "/detach 或 /mission 使用轻灵本地后台能力", ["/bg"], "[prompt]"),
  createUnavailableCommand("/branch", "Claude 会话分支", "/checkpoint 与 /resume 使用本地恢复点", [], "[name]"),
  createUnavailableCommand("/fork", "Claude forked subagent", "/agents 查看轻灵本地后台任务", [], "<directive>"),
  createUnavailableCommand("/remote-control", "Claude remote control", "/sessions 与 /resume 使用本地会话", ["/rc"]),
  createUnavailableCommand("/plugin", "Claude 插件管理", "/mcp 查看轻灵本地 MCP", [], "[subcommand]"),
  createUnavailableCommand("/theme", "Claude 主题选择", "/shortcuts 查看轻灵 TUI 输入能力"),
  createUnavailableCommand("/tui", "Claude renderer 切换", "/statusline 查看轻灵 TUI 状态线", [], "[default|fullscreen]"),
];
