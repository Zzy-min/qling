import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";

import { SlashCommand } from "./types.js";
import {
  formatPresetTableLines,
  getProviderPreset,
  listProviderPresets,
  resolveModelCandidates,
} from "../providers/presets.js";
import { openOptionPickerOrFallback } from "../tui/option-picker-helpers.js";

const execFileAsync = promisify(execFile);

const DEFAULT_MODELS = resolveModelCandidates();

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
  description: "查看 provider usage、成本完整性与压缩次数",
  usage: "/usage",
  category: "session",
  availability: "local",
  claudeCompatibleName: "/usage",
  execute: async (_args, context) => {
    const stats = typeof (context.agentLoop as any).getSessionStats === "function"
      ? await (context.agentLoop as any).getSessionStats()
      : {
          sessionId: "unknown",
          turnCount: 0,
          tokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          tokenSource: "unknown",
          compactions: 0,
        };
    const tokens = Math.max(0, Number(stats.tokens ?? 0));
    const promptTokens = Math.max(0, Number(stats.promptTokens ?? 0));
    const completionTokens = Math.max(0, Number(stats.completionTokens ?? 0));

    context.writeLine("");
    context.writeLine("📈 【Token 用量 · 官方 usage】");
    context.writeLine("-----------------------------------------");
    context.writeLine(`Session   : ${stats.sessionId ?? "unknown"}`);
    context.writeLine(`Turns     : ${Number(stats.turnCount ?? 0)}`);
    context.writeLine(`Total     : ${tokens.toLocaleString()}`);
    context.writeLine(`Input     : ${promptTokens.toLocaleString()}`);
    context.writeLine(`Output    : ${completionTokens.toLocaleString()}`);
    context.writeLine(`Source    : ${stats.tokenSource ?? "unknown"}`);
    context.writeLine(
      `Cost      : ${stats.costUsd && !stats.costIsPartial && !stats.usageIsIncomplete ? `$${stats.costUsd} (complete)` : "omitted (partial/incomplete)"}`
    );
    context.writeLine(`Compacts  : ${Number(stats.compactions ?? 0)}`);
    context.writeLine("边界      : token 仅采用 provider usage；价格或子代理 usage 缺失时不展示精确总成本。");
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};

export const modelCommand: SlashCommand = {
  name: "/model",
  description: "切换器选择模型 / Provider 预设",
  usage: "/model [list|use <preset>|model|status]",
  category: "session",
  argumentHint: "[list|use <preset>|<model>|status]",
  availability: "local",
  claudeCompatibleName: "/model",
  execute: async (args, context) => {
    const loop = context.agentLoop as any;
    const currentModel =
      typeof loop.getModel === "function"
        ? loop.getModel()
        : process.env.QLING_LLM_MODEL || "unknown";
    const currentProvider =
      typeof loop.getProvider === "function"
        ? loop.getProvider()
        : process.env.QLING_LLM_PROVIDER || "unknown";
    const currentEndpoint =
      typeof loop.getEndpoint === "function"
        ? loop.getEndpoint()
        : process.env.QLING_LLM_ENDPOINT || "unknown";

    const sub = (args[0] ?? "").trim().toLowerCase();
    const rest = args.slice(1).join(" ").trim();

    const applyPreset = async (presetKey: string): Promise<boolean> => {
      const preset = getProviderPreset(presetKey);
      if (!preset) {
        context.writeError(`❌ 未找到预设 '${presetKey}'。`);
        return false;
      }
      if (typeof loop.applyLlmSession === "function") {
        loop.applyLlmSession({
          provider: preset.provider,
          endpoint: preset.endpoint,
          model: preset.model,
          apiKey: preset.requiresApiKey ? undefined : "",
        });
      } else if (typeof loop.setModel === "function") {
        loop.setModel(preset.model);
        process.env.QLING_LLM_PROVIDER = preset.provider;
        process.env.QLING_LLM_ENDPOINT = preset.endpoint;
        process.env.QLING_LLM_MODEL = preset.model;
      } else {
        context.writeError("❌ 当前 AgentLoop 不支持 session 级模型切换。");
        return false;
      }
      await context.onModelChanged?.(preset.model);
      // 切换器确认后仅一行反馈，避免刷长文
      context.writeLine(
        `🤖 ${preset.id} · ${preset.displayName} → ${preset.model}`
      );
      return true;
    };

    const openModelPicker = (): boolean => {
      const presets = listProviderPresets();
      return openOptionPickerOrFallback(
        context,
        {
          title: "模型切换 · Provider",
          footerHint: "↑/↓ 选择预设 · Enter 应用 · Esc 取消",
          selectedId: presets.find((p) => p.model === currentModel)?.id,
          items: presets.map((p) => ({
            id: p.id,
            label: `${p.displayName || p.id}`,
            description: `${p.provider} · ${p.model}`,
            active: p.model === currentModel || p.provider === currentProvider,
          })),
          onPick: async (item) => {
            await applyPreset(item.id);
          },
        },
        () => {
          context.writeLine("");
          context.writeLine("🤖 【模型 / Provider】");
          context.writeLine("-----------------------------------------");
          context.writeLine(`当前      : ${currentProvider} · ${currentModel}`);
          context.writeLine(`Endpoint  : ${currentEndpoint}`);
          for (const line of formatPresetTableLines()) {
            context.writeLine(line);
          }
          context.writeLine("切换: /model use <preset>");
          context.writeLine("-----------------------------------------");
          context.writeLine("");
        }
      );
    };

    // 默认 / list / pick → 切换器（TUI）；status 仅文字
    if (!sub || sub === "list" || sub === "ls" || sub === "presets" || sub === "pick" || sub === "ui") {
      openModelPicker();
      return;
    }

    if (sub === "status" || sub === "状态") {
      context.writeLine("");
      context.writeLine("🤖 【模型 / Provider】");
      context.writeLine("-----------------------------------------");
      context.writeLine(`Provider  : ${currentProvider}`);
      context.writeLine(`Endpoint  : ${currentEndpoint}`);
      context.writeLine(`Model     : ${currentModel}`);
      context.writeLine(`候选模型  : ${DEFAULT_MODELS.join(", ")}`);
      context.writeLine("切换      : /model  （打开切换器）");
      context.writeLine("-----------------------------------------");
      context.writeLine("");
      return;
    }

    if (sub === "use" || sub === "preset") {
      const presetKey = rest || args[1] || "";
      if (!presetKey) {
        openModelPicker();
        return;
      }
      await applyPreset(presetKey);
      return;
    }

    // 兼容：/model <modelName> 仅切换 model
    const nextModel = args.join(" ").trim();
    if (typeof loop.setModel !== "function" && typeof loop.applyLlmSession !== "function") {
      context.writeError("❌ 当前 AgentLoop 不支持 session 级模型切换。");
      context.writeLine("-----------------------------------------");
      context.writeLine("");
      return;
    }
    if (typeof loop.applyLlmSession === "function") {
      loop.applyLlmSession({ model: nextModel });
    } else {
      loop.setModel(nextModel);
      process.env.QLING_LLM_MODEL = nextModel;
    }
    await context.onModelChanged?.(nextModel);
    context.writeLine(`已切换模型: ${currentModel} -> ${nextModel}`);
    context.writeLine(`Provider  : ${currentProvider}（未改）`);
    context.writeLine(`Endpoint  : ${currentEndpoint}（未改）`);
    context.writeLine("范围      : 仅当前会话/当前进程，不写入默认配置。");
    context.writeLine("提示      : 换供应商请用 /model use <preset>");
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};

export const planCommand: SlashCommand = {
  name: "/plan",
  description: "切换 Plan 模式（顶栏 Mode:plan · 青色输入框）",
  usage: "/plan [on|off|status|list|approve|description]",
  category: "session",
  argumentHint: "[on|off|status|list|approve|description]",
  availability: "local",
  claudeCompatibleName: "/plan",
  execute: async (args, context) => {
    // 风格对齐 Grok：模式靠 UI 标签，不刷长说明
    const {
      buildImplementPromptFromPlan,
      ensureDefaultPlanDir,
      listPlanFiles,
      readLatestPlanFile,
    } = await import("../plan/plan-artifacts.js");

    const loop = context.agentLoop as {
      isPlanMode?: () => boolean;
      setPlanMode?: (enabled: boolean) => void;
      getWorkspaceDir?: () => string;
    };
    const workspace =
      context.workspaceDir ||
      (typeof loop.getWorkspaceDir === "function" ? loop.getWorkspaceDir() : "") ||
      process.cwd();
    const sub = (args[0] ?? "").trim().toLowerCase();
    const hasPlanApi =
      typeof loop.isPlanMode === "function" && typeof loop.setPlanMode === "function";

    const readPerm = () =>
      typeof (loop as { getPermissionMode?: () => string }).getPermissionMode === "function"
        ? (loop as { getPermissionMode: () => string }).getPermissionMode()
        : "ask";

    const modeLabel = () =>
      hasPlanApi
        ? loop.isPlanMode!()
          ? "plan"
          : "agent"
        : process.env.QLING_PLAN_MODE === "1"
          ? "plan"
          : "agent";

    const paintMode = (sessionMode: "plan" | "agent", permissionMode?: string) => {
      const perm = permissionMode ?? readPerm();
      if (typeof context.applySessionChrome === "function") {
        context.applySessionChrome({ sessionMode, permissionMode: perm });
        return;
      }
      // 与 Grok 三态标签一致：normal | plan | auto
      const ui =
        sessionMode === "plan" ? "plan" : perm === "allow" ? "auto" : "normal";
      context.writeLine(`Mode: ${ui}`);
    };

    if (!sub || sub === "status") {
      paintMode(modeLabel() === "plan" ? "plan" : "agent");
      return;
    }

    if (sub === "list" || sub === "pick" || sub === "ls") {
      const files = await listPlanFiles(workspace, 40);
      if (files.length === 0) {
        context.writeLine("(no plans)");
        return;
      }
      const { openOptionPickerOrFallback } = await import("../tui/option-picker-helpers.js");
      openOptionPickerOrFallback(
        context,
        {
          title: "计划文件 · Plans",
          footerHint: "↑/↓ 选择 · Enter 写入草稿路径 · Esc 取消",
          items: files.map((f) => ({
            id: f.path,
            label: f.name,
            description: f.path,
          })),
          onPick: (item) => {
            if (typeof context.setInputDraft === "function") {
              context.setInputDraft(`请阅读并执行计划: ${item.id}`);
            }
            context.writeLine(`📋 已选计划: ${item.label}`);
          },
        },
        () => {
          for (const f of files) {
            context.writeLine(`${f.name}  ${f.path}`);
          }
        }
      );
      return;
    }

    if (sub === "on" || sub === "enable" || sub === "enter") {
      if (!hasPlanApi) {
        context.writeError("Plan mode unavailable");
        return;
      }
      loop.setPlanMode!(true);
      await ensureDefaultPlanDir(workspace);
      paintMode("plan");
      return;
    }

    if (sub === "off" || sub === "disable" || sub === "exit" || sub === "agent") {
      if (!hasPlanApi) {
        context.writeError("Plan mode unavailable");
        return;
      }
      loop.setPlanMode!(false);
      paintMode("agent");
      return;
    }

    if (sub === "approve" || sub === "go" || sub === "implement" || sub === "实施") {
      if (!hasPlanApi) {
        context.writeError("Plan mode unavailable");
        return;
      }
      loop.setPlanMode!(false);
      const latest = await readLatestPlanFile(workspace);
      if (context.setImmediatePrompt) {
        context.setImmediatePrompt(
          latest
            ? buildImplementPromptFromPlan(latest.path, latest.content)
            : "Implement the agreed plan. Prefer small verified steps."
        );
      }
      paintMode("agent");
      return;
    }

    // /plan <description>
    const description = args.join(" ").trim();
    if (hasPlanApi) loop.setPlanMode!(true);
    const planDir = await ensureDefaultPlanDir(workspace);
    const prompt = [
      `Plan mode. Read/search only; write plan markdown under ${planDir}/ only.`,
      `Task: ${description}`,
    ].join("\n");
    if (context.setImmediatePrompt) {
      context.setImmediatePrompt(prompt);
    }
    paintMode("plan");
  },
};

export const expandCommand: SlashCommand = {
  name: "/expand",
  aliases: ["/展开", "/折叠"],
  description: "切换长工具输出展开/折叠；/expand last 重放最近一次",
  usage: "/expand [on|off|status|last]",
  category: "session",
  argumentHint: "[on|off|status|last]",
  availability: "local",
  execute: async (args, context) => {
    const sub = (args[0] ?? "toggle").toLowerCase();
    const toolOutput = context.toolOutput;

    context.writeLine("");
    context.writeLine("📄 【工具输出折叠】");
    context.writeLine("-----------------------------------------");

    if (!toolOutput) {
      context.writeLine("状态      : 当前会话未挂载 TUI 工具输出控制。");
      context.writeLine("替代      : 在交互 TUI 中使用 Ctrl+O。");
      context.writeLine("-----------------------------------------");
      context.writeLine("");
      return;
    }

    if (sub === "last" || sub === "最近" || sub === "prev") {
      const ok = toolOutput.expandLast?.() ?? false;
      context.writeLine(
        ok
          ? "已重放    : 最近一次工具输出（展开模式）"
          : "无内容    : 本会话还没有可重放的工具输出"
      );
      context.writeLine("快捷键    : Ctrl+O 切换默认；/expand last 重放");
      context.writeLine("-----------------------------------------");
      context.writeLine("");
      return;
    }

    if (sub === "status" || sub === "状态") {
      context.writeLine(`当前      : ${toolOutput.expanded ? "展开" : "折叠"}`);
    } else if (sub === "on" || sub === "expand" || sub === "展开") {
      toolOutput.setExpanded(true);
      context.writeLine("已切换    : 展开后续长工具输出");
    } else if (sub === "off" || sub === "collapse" || sub === "折叠") {
      toolOutput.setExpanded(false);
      context.writeLine("已切换    : 折叠后续长工具输出");
    } else {
      const next = toolOutput.toggle();
      context.writeLine(`已切换    : ${next ? "展开" : "折叠"}后续长工具输出`);
    }

    context.writeLine("快捷键    : Ctrl+O · /expand last");
    context.writeLine("边界      : on/off 仅影响后续块；last 会重放最近一次。");
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

// /rewind 已迁至 commands/rewind.ts（真实回退用户轮）

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
  createUnavailableCommand(
    "/background",
    "Claude cloud/background agent",
    "本地后台请用 bash background:true + /tasks wait|kill，或 /mission",
    [],
    "[prompt]"
  ),
  createUnavailableCommand("/branch", "Claude 会话分支", "/fork 分叉当前会话，或 /checkpoint 与 /resume", [], "[name]"),
  createUnavailableCommand("/remote-control", "Claude remote control", "/sessions 与 /resume 使用本地会话", ["/rc"]),
  createUnavailableCommand("/tui", "Claude renderer 切换", "/statusline 查看轻灵 TUI 状态线", [], "[default|fullscreen]"),
];
