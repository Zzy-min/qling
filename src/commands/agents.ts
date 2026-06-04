import { homedir } from "os";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { renderAgentsView } from "../cli/mission-views.js";
import type { Mission } from "../mission/types.js";
import { SlashCommand } from "./types.js";
import type { SlashCommandContext } from "./runtime.js";

function resolveStateDir(context: SlashCommandContext): string {
  const loop = context.agentLoop as Record<string, any>;
  const runtimeRoot = typeof loop.getRuntimeRootDir === "function" ? loop.getRuntimeRootDir() : undefined;
  return runtimeRoot || process.env.QLING_FILE_STATE_DIR || join(context.homeDir ?? homedir(), ".qling");
}

async function listLocalMissionsReadOnly(stateDir: string): Promise<Mission[]> {
  const missionsDir = join(stateDir, "missions");
  let files: string[];
  try {
    files = await readdir(missionsDir);
  } catch {
    return [];
  }

  const missions: Mission[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(await readFile(join(missionsDir, file), "utf8")) as Mission;
      if (parsed && typeof parsed.id === "string" && typeof parsed.status === "string") {
        missions.push(parsed);
      }
    } catch {
      // Ignore corrupt mission snapshots; /doctor can surface broader storage health.
    }
  }

  return missions.sort((a, b) => b.createdAt - a.createdAt);
}

export const agentsCommand: SlashCommand = {
  name: "/agents",
  aliases: ["/代理"],
  description: "查看本地后台 mission 分组视图",
  usage: "/agents",
  execute: async (_args, context) => {
    const missions = await listLocalMissionsReadOnly(resolveStateDir(context));
    context.writeLine(renderAgentsView(missions));
  },
};
