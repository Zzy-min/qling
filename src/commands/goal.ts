import { SlashCommand } from "./types.js";

const CLEAR_ALIASES = new Set(["clear", "stop", "off", "reset", "none", "cancel"]);
const STATUS_ALIASES = new Set(["status", "show", "list", "状态", "查看", "列表"]);
const SET_ALIASES = new Set(["set", "设置"]);
const DAEMON_ALIASES = new Set(["daemon", "durable", "bg"]);

function formatGoalStatus(goal: any): string[] {
  if (!goal) {
    return ["", "◎ 当前 session 没有 active goal。", ""];
  }
  const lines = [
    "",
    "◎ /goal 状态",
    "-----------------------------------------",
    `状态     : ${goal.status}`,
    `Runner   : ${goal.runner ?? "session"}`,
    `Pending  : ${goal.pending ? "yes" : "no"}`,
    `条件     : ${goal.condition || "(空)"}`,
    `创建时间 : ${goal.createdAt ? new Date(goal.createdAt).toLocaleString() : "-"}`,
    `评估轮次 : ${goal.evaluatedTurns ?? 0}`,
    `最近原因 : ${goal.lastReason ?? "-"}`,
    "-----------------------------------------",
    "",
  ];
  return lines;
}

export const goalCommand: SlashCommand = {
  name: "/goal",
  aliases: ["/目标"],
  description: "设置、查询或清除当前 session 的 goal",
  usage: "/goal [condition|clear]",
  execute: async (args, context) => {
    const controller = context.goalController as any;
    if (!controller || typeof controller.getGoalStatus !== "function") {
      context.writeError("❌ 当前会话未启用 goal controller。");
      return;
    }

    if (args.length === 0) {
      const status = await controller.getGoalStatus();
      for (const line of formatGoalStatus(status)) {
        context.writeLine(line);
      }
      return;
    }

    const firstArg = args[0].toLowerCase();
    if (STATUS_ALIASES.has(firstArg)) {
      const status = await controller.getGoalStatus();
      for (const line of formatGoalStatus(status)) {
        context.writeLine(line);
      }
      return;
    }

    if (CLEAR_ALIASES.has(firstArg)) {
      const cleared = await controller.clearGoal("user_clear");
      context.writeLine("");
      context.writeLine(`🛑 已清除 goal: ${cleared.condition || "(空)"}`);
      context.writeLine("");
      return;
    }

    if (DAEMON_ALIASES.has(firstArg)) {
      const daemonApi = context.daemonSessionApi;
      if (!daemonApi) {
        context.writeError("❌ 当前会话未启用 daemon session API。请先启动 `qling daemon start`。");
        return;
      }
      const sessionId = (context.agentLoop as any).getSessionId?.() ?? "";
      if (!sessionId) {
        context.writeError("❌ 无法解析当前 sessionId。");
        return;
      }
      const daemonSub = args[1]?.toLowerCase();

      if (!daemonSub) {
        if (!daemonApi.getGoal) {
          context.writeError("❌ daemon session API 未实现 getGoal。");
          return;
        }
        const status = await daemonApi.getGoal(sessionId);
        for (const line of formatGoalStatus(status)) {
          context.writeLine(line);
        }
        return;
      }

      if (CLEAR_ALIASES.has(daemonSub)) {
        if (!daemonApi.clearGoal) {
          context.writeError("❌ daemon session API 未实现 clearGoal。");
          return;
        }
        const cleared = await daemonApi.clearGoal(sessionId);
        context.writeLine("");
        context.writeLine(`🛑 已清除 daemon goal: ${cleared.condition || "(空)"}`);
        context.writeLine("");
        return;
      }

      const condition = args.slice(1).join(" ").trim();
      if (!condition) {
        context.writeError("❌ 用法: /goal daemon <condition>");
        return;
      }
      const stats = typeof (context.agentLoop as any).getSessionStats === "function"
        ? await (context.agentLoop as any).getSessionStats()
        : { turnCount: 0, tokens: 0 };
      if (typeof (context.agentLoop as any).checkpointSession === "function") {
        await (context.agentLoop as any).checkpointSession();
      }
      if (!daemonApi.setGoal) {
        context.writeError("❌ daemon session API 未实现 setGoal。");
        return;
      }
      const goal = await daemonApi.setGoal(sessionId, condition, {
        turnCount: stats.turnCount ?? 0,
        tokens: stats.tokens ?? 0,
      });
      context.writeLine("");
      context.writeLine("◎ /goal daemon active");
      context.writeLine("-----------------------------------------");
      context.writeLine(`条件     : ${goal.condition}`);
      context.writeLine(`Runner   : ${goal.runner ?? "daemon"}`);
      context.writeLine("说明     : 已交由 qlingd 在后台持续推进。");
      context.writeLine("-----------------------------------------");
      context.writeLine("");
      return;
    }

    const conditionArgs = SET_ALIASES.has(firstArg) ? args.slice(1) : args;
    const condition = conditionArgs.join(" ").trim();
    if (!condition) {
      context.writeError("❌ 用法: /goal [status|set <condition>|clear|daemon ...]");
      return;
    }
    const stats = typeof (context.agentLoop as any).getSessionStats === "function"
      ? await (context.agentLoop as any).getSessionStats()
      : { turnCount: 0, tokens: 0 };
    const goal = await controller.setGoal(condition, {
      turnCount: stats.turnCount ?? 0,
      tokens: stats.tokens ?? 0,
    }, {
      runner: "session",
    });
    const immediatePrompt = controller.buildInitialPrompt(goal.condition);
    context.setImmediatePrompt?.(immediatePrompt);
    context.writeLine("");
    context.writeLine("◎ /goal active");
    context.writeLine("-----------------------------------------");
    context.writeLine(`条件     : ${goal.condition}`);
    context.writeLine(`Runner   : ${goal.runner ?? "session"}`);
    context.writeLine("说明     : 已立即启动自动续跑。");
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
