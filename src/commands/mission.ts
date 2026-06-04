import { homedir } from "os";
import { join } from "path";
import { renderAgentsView, renderMissionEvents } from "../cli/mission-views.js";
import { MissionManager } from "../mission/manager.js";
import type { Mission } from "../mission/types.js";
import { SlashCommand } from "./types.js";
import type { SlashCommandContext } from "./runtime.js";

const SUBCOMMAND_ALIASES: Record<string, string> = {
  "": "list",
  "列表": "list",
  "查看": "show",
  detail: "show",
  "详情": "show",
  "日志": "logs",
  log: "logs",
  "暂停": "pause",
  "恢复": "resume",
  "取消": "cancel",
  "停止": "cancel",
  "终止": "cancel",
  stop: "cancel",
  terminate: "cancel",
  "重试": "retry",
  respawn: "retry",
};

function resolveStateDir(context: SlashCommandContext): string {
  const loop = context.agentLoop as Record<string, any>;
  const runtimeRoot = typeof loop.getRuntimeRootDir === "function" ? loop.getRuntimeRootDir() : undefined;
  return runtimeRoot || process.env.QINGLING_FILE_STATE_DIR || join(context.homeDir ?? homedir(), ".qingling");
}

function normalizeSubcommand(value: string | undefined): string {
  const key = (value ?? "").toLowerCase();
  return SUBCOMMAND_ALIASES[key] ?? key;
}

function formatTimestamp(value: number | undefined): string {
  return value ? new Date(value).toLocaleString() : "-";
}

function formatMissionDetail(mission: Mission): string[] {
  const lines = [
    "",
    "🧭 【使命详情】",
    "-----------------------------------------",
    `ID       : ${mission.id}`,
    `名称     : ${mission.name}`,
    `状态     : ${mission.status}`,
    `会话     : ${mission.sessionId}`,
    `创建     : ${formatTimestamp(mission.createdAt)}`,
    `更新     : ${formatTimestamp(mission.updatedAt)}`,
  ];

  if (mission.sourceMissionId) {
    lines.push(`来源使命 : ${mission.sourceMissionId}`);
  }
  if (mission.error) {
    lines.push(`错误     : [${mission.error.code}] ${mission.error.message}`);
  }

  lines.push(`任务     : ${mission.description}`);
  lines.push("-----------------------------------------", "");
  return lines;
}

async function createManager(context: SlashCommandContext): Promise<MissionManager> {
  const manager = new MissionManager(resolveStateDir(context));
  await manager.init();
  return manager;
}

function requireMissionId(id: string | undefined, usage: string, context: SlashCommandContext): string | null {
  if (id) return id;
  context.writeError(`❌ 用法: ${usage}`);
  return null;
}

export const missionCommand: SlashCommand = {
  name: "/mission",
  aliases: ["/使命"],
  description: "查看或控制本地 mission",
  usage: "/mission list|show|logs|pause|resume|cancel|terminate|retry <id>",
  execute: async (args, context) => {
    const sub = normalizeSubcommand(args[0]);
    const id = args[1];

    try {
      const manager = await createManager(context);

      if (sub === "list") {
        context.writeLine(renderAgentsView(manager.listMissions()));
        return;
      }

      if (sub === "show") {
        const missionId = requireMissionId(id, "/mission show <id>", context);
        if (!missionId) return;
        for (const line of formatMissionDetail(manager.getMissionOrThrow(missionId))) {
          context.writeLine(line);
        }
        return;
      }

      if (sub === "logs") {
        const missionId = requireMissionId(id, "/mission logs <id>", context);
        if (!missionId) return;
        context.writeLine(renderMissionEvents(await manager.getMissionLogs(missionId)));
        return;
      }

      if (sub === "pause" || sub === "resume" || sub === "cancel") {
        const missionId = requireMissionId(id, `/mission ${sub} <id>`, context);
        if (!missionId) return;
        const mission =
          sub === "pause"
            ? await manager.pauseMission(missionId, "slash_local")
            : sub === "resume"
              ? await manager.resumeMission(missionId, "slash_local")
              : await manager.cancelMission(missionId, "slash_local");
        for (const line of formatMissionDetail(mission)) {
          context.writeLine(line);
        }
        return;
      }

      if (sub === "retry") {
        const missionId = requireMissionId(id, "/mission retry <id>", context);
        if (!missionId) return;
        const mission = await manager.retryMission(missionId);
        context.writeLine(`🔄 已创建本地重试使命: ${mission.id}`);
        for (const line of formatMissionDetail(mission)) {
          context.writeLine(line);
        }
        return;
      }

      context.writeError("❌ 用法: /mission list|show|logs|pause|resume|cancel|terminate|retry <id>");
    } catch (err) {
      context.writeError(`❌ mission 操作失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
