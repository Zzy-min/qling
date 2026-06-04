import { SlashCommand } from "./types.js";

function formatTimestamp(ts?: number): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

export const tasksCommand: SlashCommand = {
  name: "/tasks",
  aliases: ["/bashes", "/任务"],
  description: "查看或取消当前 session 的后台 loop 任务",
  usage: "/tasks [cancel <id>|clear|daemon [cancel <id>|clear]]",
  execute: async (args, context) => {
    const scheduler = context.scheduler as any;
    if (!scheduler || typeof scheduler.listTasks !== "function") {
      context.writeError("❌ 当前会话未启用任务调度器。");
      return;
    }

    const sub = args[0]?.toLowerCase();
    if (sub === "daemon" || sub === "durable" || sub === "bg") {
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
          context.writeLine(`  间隔: ${task.intervalMs}ms | 模式: ${task.mode} | runner: ${task.runner ?? "daemon"} | pending: ${task.pending ? "yes" : "no"}`);
          context.writeLine(`  下次: ${formatTimestamp(task.nextRunAt)} | 上次: ${formatTimestamp(task.lastRunAt)}`);
          context.writeLine(`  Prompt: ${task.prompt.slice(0, 100)}`);
        }
      }
      context.writeLine("-----------------------------------------");
      context.writeLine("");
      return;
    }

    if (sub === "cancel") {
      const id = args[1];
      if (!id) {
        context.writeError("❌ 用法: /tasks cancel <id>");
        return;
      }
      const canceled = await scheduler.cancelTask(id);
      context.writeLine("");
      context.writeLine(`🛑 已取消任务 ${canceled.id}`);
      context.writeLine("");
      return;
    }

    if (sub === "clear") {
      const count = await scheduler.cancelAllTasks();
      context.writeLine("");
      context.writeLine(`🧹 已取消 ${count} 个任务。`);
      context.writeLine("");
      return;
    }

    const tasks = await scheduler.listTasks();
    context.writeLine("");
    context.writeLine("📋 【当前 Session 任务】");
    context.writeLine("-----------------------------------------");
    if (tasks.length === 0) {
      context.writeLine("(无)");
    } else {
      for (const task of tasks) {
        context.writeLine(`- [${task.status.toUpperCase()}] ${task.id}`);
        context.writeLine(`  间隔: ${task.intervalMs}ms | 模式: ${task.mode} | runner: ${task.runner ?? "session"} | pending: ${task.pending ? "yes" : "no"}`);
        context.writeLine(`  下次: ${formatTimestamp(task.nextRunAt)} | 上次: ${formatTimestamp(task.lastRunAt)}`);
        context.writeLine(`  Prompt: ${task.prompt.slice(0, 100)}`);
      }
    }
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
