import { SlashCommand } from "./types.js";
import {
  formatBgTaskLine,
  getBackgroundTaskRegistry,
} from "../runtime/background-tasks.js";

function formatTimestamp(ts?: number): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

export const tasksCommand: SlashCommand = {
  name: "/tasks",
  aliases: ["/bashes", "/任务", "/bg"],
  description: "后台任务：shell task_id + session loop；list / wait / kill",
  usage: "/tasks [list|wait <id>|kill <id>|cancel <id>|clear|daemon …]",
  examples: [
    "/tasks",
    "/tasks wait bg_…",
    "/tasks kill bg_…",
    "/tasks cancel tsk_loop_…",
  ],
  execute: async (args, context) => {
    const sub = (args[0] ?? "list").toLowerCase();
    const reg = getBackgroundTaskRegistry();

    // ── shell background (G3.2) ─────────────────────────
    if (sub === "wait") {
      const id = args[1];
      if (!id) {
        context.writeError("用法: /tasks wait <task_id>");
        return;
      }
      const timeoutRaw = args[2];
      const timeoutMs = timeoutRaw
        ? Math.max(0, Number.parseInt(timeoutRaw, 10) || 120_000)
        : 120_000;
      try {
        context.writeLine(`⏳ waiting ${id} (timeout ${timeoutMs}ms)…`);
        const task = await reg.wait(id, timeoutMs);
        context.writeLine(formatBgTaskLine(task));
        if (task.output) {
          context.writeLine("--- output ---");
          context.writeLine(task.output.slice(0, 4000));
        }
      } catch (err) {
        context.writeError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    if (sub === "kill") {
      const id = args[1];
      if (!id) {
        context.writeError("用法: /tasks kill <task_id>");
        return;
      }
      // shell bg id 以 bg_ 开头；否则走 loop cancel
      if (id.startsWith("bg_")) {
        try {
          const task = await reg.kill(id, "user");
          context.writeLine(`🛑 ${formatBgTaskLine(task)}`);
        } catch (err) {
          context.writeError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      // fall through to loop cancel with rewritten args
      args = ["cancel", id];
    }

    const scheduler = context.scheduler as any;

    if (sub === "daemon" || sub === "durable") {
      const daemonApi = context.daemonSessionApi;
      if (!daemonApi) {
        context.writeError("❌ 当前会话未启用 daemon session API。请先启动 `qling daemon start`。");
        return;
      }
      const daemonSub = args[1]?.toLowerCase();
      const sessionId = (context.agentLoop as any).getSessionId?.() ?? "";
      if (!sessionId) {
        context.writeError("❌ 无法解析当前 sessionId。");
        return;
      }

      if (daemonSub === "cancel") {
        const id = args[2];
        if (!id) {
          context.writeError("❌ 用法: /tasks daemon cancel <id>");
          return;
        }
        if (!daemonApi.cancelLoopTask) {
          context.writeError("❌ daemon session API 未实现 cancelLoopTask。");
          return;
        }
        const canceled = await daemonApi.cancelLoopTask(sessionId, id);
        context.writeLine("");
        context.writeLine(`🛑 已取消 daemon 任务 ${canceled.id}`);
        context.writeLine("");
        return;
      }

      if (daemonSub === "clear") {
        if (!daemonApi.clearLoopTasks) {
          context.writeError("❌ daemon session API 未实现 clearLoopTasks。");
          return;
        }
        const count = await daemonApi.clearLoopTasks(sessionId);
        context.writeLine("");
        context.writeLine(`🧹 已取消 ${count} 个 daemon 任务。`);
        context.writeLine("");
        return;
      }

      if (!daemonApi.listLoopTasks) {
        context.writeError("❌ daemon session API 未实现 listLoopTasks。");
        return;
      }
      const tasks = await daemonApi.listLoopTasks(sessionId);
      context.writeLine("");
      context.writeLine("📡 【Daemon Session 任务】");
      context.writeLine("-----------------------------------------");
      if (tasks.length === 0) {
        context.writeLine("(无)");
      } else {
        for (const task of tasks) {
          context.writeLine(`- [${task.status.toUpperCase()}] ${task.id}`);
          context.writeLine(
            `  间隔: ${task.intervalMs}ms | 模式: ${task.mode} | runner: ${task.runner ?? "daemon"} | pending: ${task.pending ? "yes" : "no"}`
          );
          context.writeLine(
            `  下次: ${formatTimestamp(task.nextRunAt)} | 上次: ${formatTimestamp(task.lastRunAt)}`
          );
          context.writeLine(`  Prompt: ${task.prompt.slice(0, 100)}`);
        }
      }
      context.writeLine("-----------------------------------------");
      context.writeLine("");
      return;
    }

    const effectiveSub = args[0]?.toLowerCase() ?? sub;

    if (effectiveSub === "cancel") {
      const id = args[1];
      if (!id) {
        context.writeError("❌ 用法: /tasks cancel <id> 或 /tasks kill bg_…");
        return;
      }
      if (id.startsWith("bg_")) {
        try {
          const task = await reg.kill(id, "user");
          context.writeLine(`🛑 ${formatBgTaskLine(task)}`);
        } catch (err) {
          context.writeError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (!scheduler || typeof scheduler.cancelTask !== "function") {
        context.writeError("❌ 当前会话未启用任务调度器。");
        return;
      }
      const canceled = await scheduler.cancelTask(id);
      context.writeLine("");
      context.writeLine(`🛑 已取消任务 ${canceled.id}`);
      context.writeLine("");
      return;
    }

    if (effectiveSub === "clear") {
      let shellKilled = 0;
      for (const t of reg.list({ includeFinished: false })) {
        try {
          await reg.kill(t.taskId, "user");
          shellKilled += 1;
        } catch {
          // ignore
        }
      }
      let loopCount = 0;
      if (scheduler && typeof scheduler.cancelAllTasks === "function") {
        loopCount = await scheduler.cancelAllTasks();
      }
      context.writeLine("");
      context.writeLine(`🧹 shell bg 终止 ${shellKilled} · loop 取消 ${loopCount}`);
      context.writeLine("");
      return;
    }

    // default list
    const bgTasks = reg.list({ includeFinished: true, limit: 30 });
    context.writeLine("");
    context.writeLine("⚙️ 【Shell 后台 task_id】");
    context.writeLine("-----------------------------------------");
    if (bgTasks.length === 0) {
      context.writeLine("(无)  · bash background:true 或 agent 启动");
    } else {
      for (const t of bgTasks) {
        context.writeLine(`- ${formatBgTaskLine(t)}`);
      }
    }
    context.writeLine("-----------------------------------------");

    if (scheduler && typeof scheduler.listTasks === "function") {
      const tasks = await scheduler.listTasks();
      context.writeLine("");
      context.writeLine("📋 【Session Loop 任务】");
      context.writeLine("-----------------------------------------");
      if (tasks.length === 0) {
        context.writeLine("(无)");
      } else {
        for (const task of tasks) {
          context.writeLine(`- [${task.status.toUpperCase()}] ${task.id}`);
          context.writeLine(
            `  间隔: ${task.intervalMs}ms | 模式: ${task.mode} | runner: ${task.runner ?? "session"} | pending: ${task.pending ? "yes" : "no"}`
          );
          context.writeLine(
            `  下次: ${formatTimestamp(task.nextRunAt)} | 上次: ${formatTimestamp(task.lastRunAt)}`
          );
          context.writeLine(`  Prompt: ${task.prompt.slice(0, 100)}`);
        }
      }
      context.writeLine("-----------------------------------------");
    } else {
      context.writeLine("");
      context.writeLine("(session loop 调度器未启用)");
    }
    context.writeLine("");
    context.writeLine("提示: /tasks wait <bg_id> · /tasks kill <bg_id> · bash background:true");
    context.writeLine("");
  },
};
