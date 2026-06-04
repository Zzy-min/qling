import { SlashCommand } from "./types.js";
import { DEFAULT_LOOP_INTERVAL_MS, resolveLoopPrompt } from "../session/loop-prompt.js";
import { evaluateIsolationPolicy } from "../agents/isolation-policy.js";

function parseIntervalToken(token?: string): number | null {
  if (!token) return null;
  const match = token.trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return null;
  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

function formatInterval(ms: number): string {
  if (ms % (24 * 60 * 60 * 1000) === 0) return `${ms / (24 * 60 * 60 * 1000)}d`;
  if (ms % (60 * 60 * 1000) === 0) return `${ms / (60 * 60 * 1000)}h`;
  if (ms % (60 * 1000) === 0) return `${ms / (60 * 1000)}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

export const loopCommand: SlashCommand = {
  name: "/loop",
  aliases: ["/循环"],
  description: "在当前 session 中周期性重跑 prompt",
  usage: "/loop [interval] [prompt]",
  execute: async (args, context) => {
    const scheduler = context.scheduler as any;
    if (!scheduler || typeof scheduler.createLoopTask !== "function") {
      context.writeError("❌ 当前会话未启用 loop 调度器。");
      return;
    }

    const sub = args[0]?.toLowerCase();
    const daemonMode = sub === "daemon" || sub === "durable" || sub === "bg";
    if (sub === "stop" || sub === "cancel") {
      const taskId = args[1];
      if (!taskId) {
        context.writeError("❌ 用法: /loop stop <id>");
        return;
      }
      const canceled = await scheduler.cancelTask(taskId);
      context.writeLine("");
      context.writeLine(`🛑 已停止 loop 任务 ${canceled.id}`);
      context.writeLine("");
      return;
    }

    const loopArgs = daemonMode ? args.slice(1) : args;
    const leadingInterval = parseIntervalToken(loopArgs[0]);
    const promptArgs = leadingInterval === null ? loopArgs : loopArgs.slice(1);
    const inlinePrompt = promptArgs.join(" ").trim();
    const resolved = await resolveLoopPrompt({
      workspaceDir:
        context.workspaceDir ??
        (typeof (context.agentLoop as any).getWorkspaceDir === "function"
          ? (context.agentLoop as any).getWorkspaceDir()
          : process.cwd()),
      homeDir: context.homeDir,
      inlinePrompt: inlinePrompt || undefined,
    });

    const intervalMs = leadingInterval ?? DEFAULT_LOOP_INTERVAL_MS;
    const mode = leadingInterval === null ? "default" : "fixed";
    if (daemonMode) {
      const workspaceDir =
        context.workspaceDir ??
        (typeof (context.agentLoop as any).getWorkspaceDir === "function"
          ? (context.agentLoop as any).getWorkspaceDir()
          : process.cwd());
      const isolation = await evaluateIsolationPolicy({
        workspaceDir,
        mode: process.env.QINGLING_AGENTS_ISOLATION_MODE === "off" ? "off" : "worktree",
        requireGit: process.env.QINGLING_AGENTS_ISOLATION_REQUIRE_GIT !== "false",
        nonGitPolicy:
          process.env.QINGLING_AGENTS_ISOLATION_NON_GIT_POLICY === "deny"
            ? "deny"
            : process.env.QINGLING_AGENTS_ISOLATION_NON_GIT_POLICY === "off"
              ? "off"
              : "warn",
      });
      if (isolation.level === "deny") {
        context.writeError(`❌ ${isolation.message ?? "当前 workspace 不允许 daemon 隔离执行。"}`);
        return;
      }
      if (isolation.level === "warn") {
        context.writeLine(`⚠️ ${isolation.message ?? "当前 workspace 不是 Git 仓库，已降级执行。"}`);
      }
    }
    const task = daemonMode
      ? await createDaemonLoopTask(context, {
          prompt: resolved.prompt,
          intervalMs,
          mode,
        })
      : await scheduler.createLoopTask({
          prompt: resolved.prompt,
          intervalMs,
          mode,
          runner: "session",
        });

    context.writeLine("");
    context.writeLine(`🔁 【已创建 ${daemonMode ? "Daemon" : "Loop"} 任务】`);
    context.writeLine("-----------------------------------------");
    context.writeLine(`任务 ID   : ${task.id}`);
    context.writeLine(`执行间隔 : ${formatInterval(intervalMs)}`);
    context.writeLine(`模式     : ${mode}`);
    context.writeLine(`Runner   : ${task.runner ?? (daemonMode ? "daemon" : "session")}`);
    context.writeLine(`Prompt 来源: ${resolved.source}${resolved.path ? ` (${resolved.path})` : ""}`);
    context.writeLine(`Prompt 摘要: ${resolved.prompt.slice(0, 80)}`);
    if (leadingInterval === null && inlinePrompt) {
      context.writeLine("说明     : 当前版本对“只给 prompt”的 /loop 采用固定 10m 轮询。");
    }
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};

async function createDaemonLoopTask(
  context: any,
  payload: { prompt: string; intervalMs: number; mode: "fixed" | "default" }
) {
  if (!context.daemonSessionApi?.createLoopTask) {
    throw new Error("当前会话未启用 daemon session API。请先启动 `qling daemon start`。");
  }
  if (typeof context.agentLoop?.checkpointSession === "function") {
    await context.agentLoop.checkpointSession();
  }
  return context.daemonSessionApi.createLoopTask(context.agentLoop.getSessionId(), {
    ...payload,
    runner: "daemon",
  });
}
