import { homedir } from "os";
import { join } from "path";
import { readFile } from "fs/promises";
import { normalizeMemoryEntries } from "../memory.js";
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
    "add": "add",
    "添加": "add",
    "delete": "delete",
    "remove": "delete",
    "删除": "delete",
    "edit": "edit",
    "update": "edit",
    "修改": "edit",
    "更新": "edit",
    "migrate": "migrate",
    "迁移": "migrate",
  };
  return aliases[normalized] ?? normalized;
}

export const memoryCommand: SlashCommand = {
  name: "/memory",
  aliases: ["/记忆"],
  description: "查看本地持久化记忆索引",
  usage: "/memory [list] [global|workspace] [count] | /memory add <fact> [--global] | /memory delete <id> | /memory edit <id> <new_content> | /memory migrate legacy --to <workspace|global> [--apply]",
  execute: async (args, context) => {
    const stateDir = resolveStateDir(context);
    const [rawSub, ...rest] = args;
    const sub = normalizeSubcommand(rawSub);

    const agentLoop = context.agentLoop as any;
    const memoryStore = agentLoop.getMemoryStore?.();
    const workspaceMemoryDir = memoryStore ? memoryStore.getWorkspaceMemoryDir() : join(stateDir, "memory");
    const globalMemoryDir = memoryStore ? memoryStore.getGlobalMemoryDir() : join(stateDir, "memory/global");

    if (sub === "migrate") {
      const source = rest[0];
      const toIndex = rest.indexOf("--to");
      const target = toIndex >= 0 ? rest[toIndex + 1] : undefined;
      if (source !== "legacy" || (target !== "workspace" && target !== "global")) {
        context.writeError("用法: /memory migrate legacy --to <workspace|global> [--apply]");
        return;
      }
      if (!memoryStore) {
        context.writeError("当前会话不支持内存存储。");
        return;
      }
      const legacyFile = join(stateDir, "memory", "memory.json");
      let entries;
      try {
        entries = normalizeMemoryEntries(JSON.parse(await readFile(legacyFile, "utf8")));
      } catch (error) {
        context.writeError(`无法读取旧版记忆: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      const apply = rest.includes("--apply");
      if (!apply) {
        context.writeLine(`dry-run: 将从 ${legacyFile} 迁移 ${entries.length} 条到 ${target}；追加 --apply 才会写入。`);
        return;
      }
      memoryStore.importScopedPersisted(entries, target);
      await memoryStore.saveToDisk();
      context.writeLine(`已迁移 ${entries.length} 条旧版记忆到 ${target}；源文件已保留。`);
      return;
    }

    if (sub === "add") {
      const isGlobal = args.includes("--global");
      const factParts = rest.filter(x => x !== "--global");
      const fact = factParts.join(" ").trim();
      if (!fact) {
        context.writeError("用法: /memory add <fact> [--global]");
        return;
      }
      if (memoryStore) {
        memoryStore.add(fact, "manual", 0.8, isGlobal ? "global" : "workspace");
        await memoryStore.saveToDisk();
        context.writeLine(`成功添加记忆到 ${isGlobal ? "全局" : "工作区"}。`);
      } else {
        context.writeError("当前会话不支持内存存储。");
      }
      return;
    }

    if (sub === "delete" || sub === "remove") {
      const id = rest[0];
      if (!id) {
        context.writeError("用法: /memory delete <id>");
        return;
      }
      if (memoryStore) {
        const removedWs = memoryStore.remove(id, "workspace");
        const removedGlobal = memoryStore.remove(id, "global");
        if (removedWs || removedGlobal) {
          await memoryStore.saveToDisk();
          context.writeLine(`成功删除记忆 ID: ${id}`);
        } else {
          context.writeError(`未找到记忆 ID: ${id}`);
        }
      } else {
        context.writeError("当前会话不支持内存存储。");
      }
      return;
    }

    if (sub === "edit" || sub === "update") {
      const id = rest[0];
      const newContent = rest.slice(1).join(" ").trim();
      if (!id || !newContent) {
        context.writeError("用法: /memory edit <id> <new_content>");
        return;
      }
      if (memoryStore) {
        const updatedWs = memoryStore.update(id, { content: newContent }, "workspace");
        const updatedGlobal = memoryStore.update(id, { content: newContent }, "global");
        if (updatedWs || updatedGlobal) {
          await memoryStore.saveToDisk();
          context.writeLine(`成功更新记忆 ID: ${id}`);
        } else {
          context.writeError(`未找到记忆 ID: ${id}`);
        }
      } else {
        context.writeError("当前会话不支持内存存储。");
      }
      return;
    }

    if (sub === "show") {
      const id = rest[0];
      if (!id) {
        context.writeError("用法: /memory show <id>");
        return;
      }
      const entry = (await findLocalMemoryEntry(workspaceMemoryDir, id)) || (await findLocalMemoryEntry(globalMemoryDir, id));
      if (entry) {
        for (const line of formatLocalMemoryEntry(entry)) {
          context.writeLine(line);
        }
      } else {
        context.writeError(`未找到记忆 ID: ${id}`);
      }
      return;
    }

    if (sub === "search") {
      const request = parseMemorySearchArgs(rest);
      if (!request.query) {
        context.writeError("用法: /memory search <query> [count]");
        return;
      }
      const wsReport = await searchLocalMemoryEntries(workspaceMemoryDir, request);
      const globalReport = await searchLocalMemoryEntries(globalMemoryDir, request);

      const mergedEntries = [
        ...wsReport.entries.map(e => ({ ...e, preview: "[工作区] " + e.preview })),
        ...globalReport.entries.map(e => ({ ...e, preview: "[全局] " + e.preview }))
      ];
      mergedEntries.sort((a, b) => b.score - a.score);

      const report = {
        stateDir: workspaceMemoryDir,
        memoryDir: workspaceMemoryDir,
        memoryFile: join(workspaceMemoryDir, "memory.json"),
        query: request.query,
        entries: mergedEntries.slice(0, request.count),
        totalEntries: wsReport.totalEntries + globalReport.totalEntries,
        totalMatches: wsReport.totalMatches + globalReport.totalMatches,
        requestedCount: request.count,
        truncated: mergedEntries.length > request.count,
        warnings: [...wsReport.warnings, ...globalReport.warnings],
      };

      for (const line of formatLocalMemorySearchReport(report)) {
        context.writeLine(line);
      }
      return;
    }

    if (sub === "practices") {
      const report = await listLocalMemoryPractices(workspaceMemoryDir, {
        count: parseMemoryReportCount(rest[0]),
      });
      for (const line of formatLocalMemoryPracticesReport(report)) {
        context.writeLine(line);
      }
      return;
    }

    if (sub === "sources") {
      const report = await buildLocalMemorySourcesReport(workspaceMemoryDir);
      for (const line of formatLocalMemorySourcesReport(report)) {
        context.writeLine(line);
      }
      return;
    }

    if (sub === "graph") {
      const report = await listLocalMemoryGraph(workspaceMemoryDir, {
        count: parseMemoryReportCount(rest[0]),
      });
      for (const line of formatLocalMemoryGraphReport(report)) {
        context.writeLine(line);
      }
      return;
    }

    // List operation
    let targetDir = workspaceMemoryDir;
    let countVal: string | undefined = undefined;

    if (rawSub === "global" || rawSub === "全局") {
      targetDir = globalMemoryDir;
      countVal = rest[0];
    } else if (rawSub === "workspace" || rawSub === "工作区") {
      targetDir = workspaceMemoryDir;
      countVal = rest[0];
    } else {
      countVal = rawSub === "list" ? rest[0] : rawSub;
    }

    const report = await buildLocalMemoryReport(targetDir, {
      count: parseMemoryReportCount(countVal),
    });
    for (const line of formatLocalMemoryReport(report)) {
      context.writeLine(line);
    }
  },
};
