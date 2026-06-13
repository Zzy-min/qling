import { homedir } from "os";
import { join } from "path";
import {
  buildLocalMemoryReport,
  buildLocalMemorySourcesReport,
  findLocalMemoryEntry,
  formatLocalMemoryEntry,
  formatLocalMemoryGraphReport,
  formatLocalMemoryPracticesReport,
  formatLocalMemoryReport,
  formatLocalMemorySearchReport,
  formatLocalMemorySourcesReport,
  listLocalMemoryGraph,
  listLocalMemoryPractices,
  parseMemoryReportCount,
  parseMemorySearchArgs,
  searchLocalMemoryEntries,
} from "../memory-report.js";
import type { SlashCommandContext } from "./runtime.js";
import { SlashCommand } from "./types.js";

function resolveStateDir(context: SlashCommandContext): string {
  const agentLoop = context.agentLoop as any;
  return agentLoop.getRuntimeRootDir?.()
    || process.env.QLING_FILE_STATE_DIR
    || join(context.homeDir ?? homedir(), ".qling");
}

function normalizeSubcommand(value: string | undefined): string {
  const normalized = (value ?? "").toLowerCase();
  const aliases: Record<string, string> = {
    "": "list",
    "status": "list",
    "状态": "list",
    "list": "list",
    "列表": "list",
    "practice": "practices",
    "practices": "practices",
    "实践": "practices",
    "经验": "practices",
    "graph": "graph",
    "图谱": "graph",
    "知识图谱": "graph",
    "search": "search",
    "搜索": "search",
    "source": "sources",
    "sources": "sources",
    "来源": "sources",
    "来源图": "sources",
    "show": "show",
    "查看": "show",
    "详情": "show",
  };
  return aliases[normalized] ?? normalized;
}

export const memoryCommand: SlashCommand = {
  name: "/memory",
  aliases: ["/记忆"],
  description: "查看本地持久化记忆索引",
  usage: "/memory [count] | /memory graph [count] | /memory show <id>",
  execute: async (args, context) => {
    const stateDir = resolveStateDir(context);
    const [rawSub, ...rest] = args;
    const sub = normalizeSubcommand(rawSub);

    if (sub === "show") {
      const id = rest[0];
      if (!id) {
        context.writeError("用法: /memory show <id>");
        return;
      }
      const entry = await findLocalMemoryEntry(stateDir, id);
      for (const line of formatLocalMemoryEntry(entry)) {
        context.writeLine(line);
      }
      return;
    }

    if (sub === "search") {
      const request = parseMemorySearchArgs(rest);
      if (!request.query) {
        context.writeError("用法: /memory search <query> [count]");
        return;
      }
      const report = await searchLocalMemoryEntries(stateDir, request);
      for (const line of formatLocalMemorySearchReport(report)) {
        context.writeLine(line);
      }
      return;
    }

    if (sub === "practices") {
      const report = await listLocalMemoryPractices(stateDir, {
        count: parseMemoryReportCount(rest[0]),
      });
      for (const line of formatLocalMemoryPracticesReport(report)) {
        context.writeLine(line);
      }
      return;
    }

    if (sub === "sources") {
      const report = await buildLocalMemorySourcesReport(stateDir);
      for (const line of formatLocalMemorySourcesReport(report)) {
        context.writeLine(line);
      }
      return;
    }

    if (sub === "graph") {
      const report = await listLocalMemoryGraph(stateDir, {
        count: parseMemoryReportCount(rest[0]),
      });
      for (const line of formatLocalMemoryGraphReport(report)) {
        context.writeLine(line);
      }
      return;
    }

    const count = sub === "list" ? rest[0] : rawSub;
    const report = await buildLocalMemoryReport(stateDir, {
      count: parseMemoryReportCount(count),
    });
    for (const line of formatLocalMemoryReport(report)) {
      context.writeLine(line);
    }
  },
};
