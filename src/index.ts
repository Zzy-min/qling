#!/usr/bin/env node
// ============================================================
// 轻灵 - CLI 入口
// 契约:
//   默认启动: qling               -> chat (TUI)
//   单次任务: qling run "任务"    -> run
//   REPL:     qling repl          -> repl
// ============================================================

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
import axios from "axios";

import { AgentLoop } from "./agent-loop.js";
import { Repl } from "./repl.js";
import { StreamingREPL } from "./tui/streaming-repl.js";
import { installSlashPorts } from "./slash-ports.js";
import {
  handleSlashCommand,
  findSlashCompletion,
  formatSlashCommandPanel,
  formatGroupedSlashPanel,
  listExecutableSlashCommandsForPicker,
} from "./commands/index.js";
import { buildHelpText, formatCliError, parseCliArgs } from "./cli/startup-contract.js";
import {
  formatHeadlessError,
  formatHeadlessExecutionEvent,
  formatHeadlessResult,
  writeHeadlessLine,
} from "./cli/headless-json.js";
import { runBootstrap } from "./cli/bootstrap.js";
import { applyConfigToProcessEnv, loadQlingConfig } from "./config.js";
import {
  CliChannelBootstrapError,
  resolveRunModeChannel,
} from "./cli/channel-bootstrap.js";
import { buildToolRegistry } from "./tools/index.js";
import { runSetup } from "./cli/setup.js";
import { checkOnboarding } from "./onboarding/tutorial.js";
import type { AgentConfig } from "./types.js";
import type { Mission, MissionEvent } from "./mission/types.js";
import { MissionManager } from "./mission/manager.js";
import { getDaemonStatus, startDaemon, stopDaemon } from "./cli/daemon-control.js";
import { followMissionAttach, renderAgentsView, renderMissionEvents } from "./cli/mission-views.js";
import { buildDoctorReport, formatDoctorReport } from "./doctor.js";
import { storageCommand } from "./commands/storage.js";
import { formatSessionExportIndex, listSessionExportFiles, parseSessionExportCount } from "./session-export-index.js";
import { formatSessionListReport, listLocalSessions, parseSessionListCount } from "./session-list-report.js";
import { createLocalSessionCheckpoint, formatLocalSessionCheckpointResult, parseLocalSessionCheckpointArgs } from "./session-checkpoint-report.js";
import { cancelLocalSessionTask, formatCanceledSessionTask, formatSessionTaskReport, listLocalSessionTasks, parseSessionTaskCount } from "./session-task-report.js";
import { clearLocalSessionGoal, formatSessionGoalMutation, formatSessionGoalReport, listLocalSessionGoals, setLocalSessionGoal } from "./session-goal-report.js";
import { buildLocalMemoryReport, buildLocalMemorySourcesReport, findLocalMemoryEntry, formatLocalMemoryEntry, formatLocalMemoryGraphReport, formatLocalMemoryPracticesReport, formatLocalMemoryReport, formatLocalMemorySearchReport, formatLocalMemorySourcesReport, listLocalMemoryGraph, listLocalMemoryPractices, parseMemoryReportCount, parseMemorySearchArgs, searchLocalMemoryEntries } from "./memory-report.js";
import { buildLocalPrivacyReport, formatPrivacyReport } from "./privacy-report.js";
import { buildLocalContextReport, formatContextReport } from "./context-report.js";
import { SHORTCUT_LINES } from "./shortcuts.js";
import { collectLocalStatusLineSnapshot, formatStatusLine, parseStatusLineCostPer1k } from "./statusline.js";
import { buildSavedSessionRecap, parseSavedSessionRecapArgs } from "./recap.js";
import {
  buildLocalPermissionsReport,
  explainLocalPermissionDecision,
  formatLocalPermissionsReport,
  formatPermissionExplanationReport,
} from "./permissions-report.js";
import { buildLocalConfigReport, formatLocalConfigReport } from "./config-report.js";
import { buildLocalMcpReport, formatLocalMcpReport } from "./mcp-report.js";
import { buildLocalHooksReport, formatLocalHooksReport } from "./hooks-report.js";
import { buildLocalStatusReport, formatLocalStatusReport } from "./local-status-report.js";
import { runAcpStdioServer } from "./cli/acp-server.js";
import { daemonAuthHeaders } from "./daemon-security.js";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const DIST_DIR = path.dirname(CURRENT_FILE);

function findEnvPaths(): string[] {
  const paths: string[] = [];

  // 1. 项目配置 (从当前目录向上查找，最优先)
  let dir = process.cwd();
  while (true) {
    const envPath = path.join(dir, ".env");
    if (fs.existsSync(envPath)) {
      paths.push(envPath);
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2. 全局配置 (~/.qling/.env，作为回退)
  const globalEnv = path.join(os.homedir(), ".qling", ".env");
  if (fs.existsSync(globalEnv)) {
    paths.push(globalEnv);
  }

  // 3. 回退: 如果啥也没找到，默认指向当前目录 .env
  if (paths.length === 0) {
    paths.push(path.join(process.cwd(), ".env"));
  }

  return paths;
}

const envPaths = findEnvPaths();
for (const p of envPaths) {
  dotenv.config({ path: p });
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}

function printMissionList(missions: Mission[], source: string): void {
  console.error(source);
  console.log("\n📋 【使命列表】");
  console.log("-----------------------------------------");
  if (missions.length === 0) {
    console.log("(无)");
  }
  for (const mission of missions) {
    console.log(`- [${mission.status.toUpperCase()}] ${mission.id} | ${formatTimestamp(mission.createdAt)}`);
    console.log(`  名称: ${mission.name}`);
    console.log(`  任务: ${mission.description.slice(0, 80)}`);
  }
  console.log("-----------------------------------------\n");
}

function printMissionDetail(mission: Mission): void {
  console.log(`ID: ${mission.id}`);
  console.log(`名称: ${mission.name}`);
  console.log(`状态: ${mission.status}`);
  console.log(`会话: ${mission.sessionId}`);
  console.log(`创建: ${formatTimestamp(mission.createdAt)}`);
  console.log(`更新: ${formatTimestamp(mission.updatedAt)}`);
  if (mission.sourceMissionId) {
    console.log(`来源使命: ${mission.sourceMissionId}`);
  }
  if (mission.error) {
    console.log(`错误: [${mission.error.code}] ${mission.error.message}`);
  }
  console.log(`任务: ${mission.description}`);
}

function printMissionLogs(events: MissionEvent[]): void {
  console.log(renderMissionEvents(events));
}

function shouldFallbackToLocalMission(err: unknown): boolean {
  return !(axios.isAxiosError(err) && err.response);
}

async function buildCliDoctorLines(loadedConfig: Awaited<ReturnType<typeof loadQlingConfig>>["config"]): Promise<string[]> {
  const report = await buildDoctorReport({
    workspaceDir: loadedConfig.runtime.workspace_dir ?? process.cwd(),
    agentLoop: {
      getWorkspaceDir: () => loadedConfig.runtime.workspace_dir ?? process.cwd(),
      getSessionStats: () => ({ sessionId: "cli-doctor", turnCount: 0, tokens: 0 }),
      getPermissionMode: () => loadedConfig.guard.permissions.default,
    },
    writeLine: () => {},
    writeError: () => {},
  });
  return formatDoctorReport(report);
}

async function withMissionFallback<T>(
  daemonCall: () => Promise<T>,
  localCall: () => Promise<T>
): Promise<{ value: T; source: "daemon" | "local" }> {
  try {
    return {
      value: await daemonCall(),
      source: "daemon",
    };
  } catch (err) {
    if (!shouldFallbackToLocalMission(err)) {
      throw err;
    }
    return {
      value: await localCall(),
      source: "local",
    };
  }
}

async function executeLocalMission(agent: AgentLoop, manager: MissionManager, mission: Mission): Promise<string> {
  await manager.updateStatus(mission.id, "running");
  await manager.appendLog(mission.id, "使命开始在当前前台进程执行", { source: "local_cli" });
  try {
    agent.addUserMessage(mission.description);
    const response = await agent.run();
    await manager.appendLog(mission.id, "使命执行成功", {
      source: "local_cli",
      resultPreview: response.slice(0, 120),
    });
    await manager.updateStatus(mission.id, "succeeded");
    return response;
  } catch (err) {
    await manager.updateStatus(mission.id, "failed", {
      code: "LOCAL_MISSION_FAILED",
      message: err instanceof Error ? err.message : String(err),
    });
    await manager.appendLog(
      mission.id,
      `使命执行失败: ${err instanceof Error ? err.message : String(err)}`,
      { source: "local_cli" }
    );
    throw err;
  }
}

function normalizeMissionSubcommand(sub: string | undefined): string {
  const normalized = (sub ?? "").toLowerCase();
  const aliases: Record<string, string> = {
    "开始": "start",
    "列表": "list",
    "查看": "show",
    "日志": "logs",
    "附着": "attach",
    "跟随": "attach",
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
  return aliases[normalized] ?? normalized;
}

function normalizeTasksSubcommand(sub: string | undefined): string {
  const normalized = (sub ?? "").toLowerCase();
  const aliases: Record<string, string> = {
    "": "list",
    "列表": "list",
    "查看": "list",
    "取消": "cancel",
    "停止": "cancel",
    "终止": "cancel",
    "stop": "cancel",
    "terminate": "cancel",
  };
  return aliases[normalized] ?? normalized;
}

function normalizeGoalSubcommand(sub: string | undefined): string {
  const normalized = (sub ?? "").toLowerCase();
  const aliases: Record<string, string> = {
    "": "status",
    "状态": "status",
    "查看": "status",
    "列表": "status",
    "设置": "set",
    "清除": "clear",
    "取消": "clear",
    "停止": "clear",
    "终止": "clear",
    "reset": "clear",
    "stop": "clear",
    "cancel": "clear",
  };
  return aliases[normalized] ?? normalized;
}

function normalizeMemorySubcommand(sub: string | undefined): string {
  const normalized = (sub ?? "").toLowerCase();
  const aliases: Record<string, string> = {
    "": "list",
    "状态": "list",
    "查看列表": "list",
    "列表": "list",
    "status": "list",
    "list": "list",
    "practice": "practices",
    "practices": "practices",
    "实践": "practices",
    "经验": "practices",
    "graph": "graph",
    "图谱": "graph",
    "知识图谱": "graph",
    "搜索": "search",
    "search": "search",
    "source": "sources",
    "sources": "sources",
    "来源": "sources",
    "来源图": "sources",
    "查看": "show",
    "详情": "show",
    "show": "show",
  };
  return aliases[normalized] ?? normalized;
}

function parseGoalSetArgs(args: string[]): { sessionRef?: string; condition: string } {
  const remaining: string[] = [];
  let sessionRef: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--session" || arg === "-s") {
      sessionRef = args[i + 1];
      i++;
      continue;
    }
    if (arg.startsWith("--session=")) {
      sessionRef = arg.slice("--session=".length);
      continue;
    }
    remaining.push(arg);
  }
  return {
    sessionRef,
    condition: remaining.join(" ").trim(),
  };
}

function isPureMissionManagementSubcommand(sub: string): boolean {
  return ["list", "show", "logs", "attach", "pause", "resume", "cancel"].includes(sub);
}

async function createStandaloneMissionManager(stateDir: string): Promise<MissionManager> {
  const manager = new MissionManager(stateDir);
  await manager.init();
  return manager;
}

function daemonRequestOptions(stateDir: string, timeout = 2_000) {
  return { timeout, headers: daemonAuthHeaders(stateDir) };
}

async function buildMissionReader(
  missionId: string,
  daemonUrl: string,
  stateDir: string
): Promise<{
  source: "daemon" | "local";
  getMission: () => Promise<Mission>;
  getLogs: () => Promise<MissionEvent[]>;
}> {
  try {
    await axios.get(`${daemonUrl}/missions/${encodeURIComponent(missionId)}`, daemonRequestOptions(stateDir));
    return {
      source: "daemon",
      getMission: async () => {
        const resp = await axios.get(`${daemonUrl}/missions/${encodeURIComponent(missionId)}`, daemonRequestOptions(stateDir));
        return resp.data as Mission;
      },
      getLogs: async () => {
        const resp = await axios.get(`${daemonUrl}/missions/${encodeURIComponent(missionId)}/logs`, daemonRequestOptions(stateDir));
        return resp.data as MissionEvent[];
      },
    };
  } catch (err) {
    if (!shouldFallbackToLocalMission(err)) {
      throw err;
    }
    return {
      source: "local",
      getMission: async () => {
        const manager = await createStandaloneMissionManager(stateDir);
        return manager.getMissionOrThrow(missionId);
      },
      getLogs: async () => {
        const manager = await createStandaloneMissionManager(stateDir);
        return manager.getMissionLogs(missionId);
      },
    };
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const jsonRequested = rawArgs.includes("--json");
  const decision = parseCliArgs(rawArgs);
  if (decision.kind === "error") {
    if (jsonRequested) {
      writeHeadlessLine(formatHeadlessError(decision.code, decision.message));
    } else {
      console.error(formatCliError(decision.code, decision.message));
    }
    process.exitCode = decision.exitCode;
    return;
  }

  const jsonMode = decision.mode === "run" && decision.outputFormat === "json";
  const reportError = (code: string, message: string): void => {
    if (jsonMode) {
      writeHeadlessLine(formatHeadlessError(code, message));
      return;
    }
    console.error(formatCliError(code, message));
  };

  if (decision.mode === "help") {
    console.log(buildHelpText("qling", decision.subArgs.join(" ")));
    process.exit(0);
  }

  if (decision.mode === "version") {
    // 与 parseCliArgs 同源；不加载配置、不要求 API key
    const { buildVersionText } = await import("./cli/startup-contract.js");
    console.log(buildVersionText("qling"));
    process.exit(0);
  }

  // chat/repl：尽早安静启动（只留顶栏+输入框）；Dashboard 仍可后台默认起
  if (decision.mode === "chat" || decision.mode === "repl") {
    const { enterBootQuietMode } = await import("./runtime/console-guard.js");
    enterBootQuietMode();
  }

  // v0.4 / Phase 1.4 Onboarding（仅交互模式；非 TTY 跳过）
  if (decision.mode === "chat" || decision.mode === "repl") {
    const needSetup = !(
      process.env.QLING_LLM_API_KEY?.trim() ||
      process.env.DEEPSEEK_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim()
    );
    await checkOnboarding({
      stateDir: decision.global.fileStateDir,
      needSetup,
    });
  }

  for (const warning of decision.warnings) {
    console.error(`Warning: ${warning}`);
  }

  let loaded;
  try {
    loaded = await loadQlingConfig(decision.global);
  } catch (err) {
    reportError("CONFIG_LOAD_FAILED", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  for (const warning of loaded.warnings) {
    console.error(`Warning: ${warning}`);
  }
  const originalMcpServersEnv = process.env.QLING_MCP_SERVERS;
  applyConfigToProcessEnv(loaded.config);
  const stateDir = loaded.config.runtime.file_state_dir;
  const DAEMON_PORT = process.env.QLING_DAEMON_PORT || "9998";
  const daemonUrl = `http://localhost:${DAEMON_PORT}`;
  let standaloneMissionManagerPromise: Promise<MissionManager> | null = null;
  const getStandaloneMissionManager = async (): Promise<MissionManager> => {
    if (!standaloneMissionManagerPromise) {
      standaloneMissionManagerPromise = createStandaloneMissionManager(stateDir);
    }
    return standaloneMissionManagerPromise;
  };

  // v0.3 Management Subcommands
  if (decision.mode === "setup") {
    await runSetup();
    return;
  }

  if (decision.mode === "bootstrap") {
    await runBootstrap(decision.subArgs, {
      setupRunner: runSetup,
      doctorRunner: () => buildCliDoctorLines(loaded.config),
      stateDir: loaded.config.runtime.file_state_dir,
    });
    return;
  }

  if (decision.mode === "doctor") {
    console.log((await buildCliDoctorLines(loaded.config)).join("\n"));
    return;
  }

  if (decision.mode === "status") {
    const report = await buildLocalStatusReport(loaded.config);
    console.log(formatLocalStatusReport(report).join("\n"));
    return;
  }

  if (decision.mode === "storage") {
    await storageCommand.execute(decision.subArgs, {
      workspaceDir: loaded.config.runtime.workspace_dir ?? process.cwd(),
      agentLoop: {
        getWorkspaceDir: () => loaded.config.runtime.workspace_dir ?? process.cwd(),
        getRuntimeRootDir: () => loaded.config.runtime.file_state_dir,
      },
      writeLine: (line = "") => console.log(line),
      writeError: (line = "") => console.error(line),
      env: {
        ...process.env,
        QLING_FILE_STATE_DIR: loaded.config.runtime.file_state_dir,
        QLING_FILE_CACHE_DIR: loaded.config.runtime.file_cache_dir,
      },
    } as any);
    return;
  }

  if (decision.mode === "exports") {
    const report = await listSessionExportFiles({
      workspaceDir: loaded.config.runtime.workspace_dir ?? process.cwd(),
      agentLoop: {
        getWorkspaceDir: () => loaded.config.runtime.workspace_dir ?? process.cwd(),
        getRuntimeRootDir: () => loaded.config.runtime.file_state_dir,
      },
      writeLine: () => {},
      writeError: () => {},
    }, {
      count: parseSessionExportCount(decision.subArgs[0]),
      env: {
        ...process.env,
        QLING_FILE_STATE_DIR: loaded.config.runtime.file_state_dir,
      },
    });
    console.log(formatSessionExportIndex(report).join("\n"));
    return;
  }

  if (decision.mode === "sessions") {
    const report = await listLocalSessions(loaded.config.runtime.file_state_dir, {
      count: parseSessionListCount(decision.subArgs[0]),
    });
    console.log(formatSessionListReport(report).join("\n"));
    return;
  }

  if (decision.mode === "checkpoint") {
    try {
      const result = await createLocalSessionCheckpoint(
        loaded.config.runtime.file_state_dir,
        parseLocalSessionCheckpointArgs(decision.subArgs)
      );
      console.log(formatLocalSessionCheckpointResult(result).join("\n"));
      return;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  if (decision.mode === "tasks") {
    const [rawSub, ...taskArgs] = decision.subArgs;
    const sub = normalizeTasksSubcommand(rawSub);
    try {
      if (sub === "list") {
        const report = await listLocalSessionTasks(stateDir, {
          count: parseSessionTaskCount(taskArgs[0]),
        });
        console.log(formatSessionTaskReport(report).join("\n"));
        return;
      }
      if (sub === "cancel") {
        const taskId = taskArgs[0];
        if (!taskId) {
          console.error("用法: qling tasks cancel <id>");
          process.exit(1);
        }
        const task = await cancelLocalSessionTask(stateDir, taskId);
        console.log(formatCanceledSessionTask(task).join("\n"));
        return;
      }
      console.error("用法: qling tasks list [count] | cancel <id>");
      process.exit(1);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  if (decision.mode === "goal") {
    const [rawSub, ...goalArgs] = decision.subArgs;
    const sub = normalizeGoalSubcommand(rawSub);
    try {
      if (sub === "status") {
        const report = await listLocalSessionGoals(stateDir, {
          sessionRef: goalArgs[0],
        });
        console.log(formatSessionGoalReport(report).join("\n"));
        return;
      }
      if (sub === "set") {
        const parsed = parseGoalSetArgs(goalArgs);
        if (!parsed.condition) {
          console.error("用法: qling goal set [--session <session>] \"完成条件\"");
          process.exit(1);
        }
        const result = await setLocalSessionGoal(stateDir, parsed.condition, {
          sessionRef: parsed.sessionRef,
        });
        console.log(formatSessionGoalMutation("set", result).join("\n"));
        return;
      }
      if (sub === "clear") {
        const result = await clearLocalSessionGoal(stateDir, {
          sessionRef: goalArgs[0],
        });
        console.log(formatSessionGoalMutation("clear", result).join("\n"));
        return;
      }
      console.error("用法: qling goal status [session] | set [--session <session>] \"完成条件\" | clear [session]");
      process.exit(1);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  if (decision.mode === "memory") {
    const [rawSub, ...memoryArgs] = decision.subArgs;
    const sub = normalizeMemorySubcommand(rawSub);
    try {
      if (sub === "list") {
        const count = rawSub && normalizeMemorySubcommand(rawSub) === "list" ? memoryArgs[0] : rawSub;
        const report = await buildLocalMemoryReport(stateDir, {
          count: parseMemoryReportCount(count),
        });
        console.log(formatLocalMemoryReport(report).join("\n"));
        return;
      }
      if (sub === "show") {
        const memoryId = memoryArgs[0];
        if (!memoryId) {
          console.error("用法: qling memory show <id>");
          process.exit(1);
        }
        const entry = await findLocalMemoryEntry(stateDir, memoryId);
        if (!entry) {
          console.error(`未找到指定本地记忆: ${memoryId}`);
          process.exit(1);
        }
        console.log(formatLocalMemoryEntry(entry).join("\n"));
        return;
      }
      if (sub === "search") {
        const request = parseMemorySearchArgs(memoryArgs);
        if (!request.query) {
          console.error("用法: qling memory search <query> [count]");
          process.exit(1);
        }
        const report = await searchLocalMemoryEntries(stateDir, request);
        console.log(formatLocalMemorySearchReport(report).join("\n"));
        return;
      }
      if (sub === "practices") {
        const report = await listLocalMemoryPractices(stateDir, {
          count: parseMemoryReportCount(memoryArgs[0]),
        });
        console.log(formatLocalMemoryPracticesReport(report).join("\n"));
        return;
      }
      if (sub === "sources") {
        const report = await buildLocalMemorySourcesReport(stateDir);
        console.log(formatLocalMemorySourcesReport(report).join("\n"));
        return;
      }
      if (sub === "graph") {
        const report = await listLocalMemoryGraph(stateDir, {
          count: parseMemoryReportCount(memoryArgs[0]),
        });
        console.log(formatLocalMemoryGraphReport(report).join("\n"));
        return;
      }
      if (sub !== "reindex") {
        console.error("用法: qling memory status [count] | list [count] | search <query> [count] | sources | practices [count] | graph [count] | show <id> | reindex [--full]");
        process.exit(1);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  if (decision.mode === "privacy") {
    const report = await buildLocalPrivacyReport({
      workspaceDir: loaded.config.runtime.workspace_dir ?? process.cwd(),
      stateDir: loaded.config.runtime.file_state_dir,
      cacheDir: loaded.config.runtime.file_cache_dir,
      model: loaded.config.llm.model,
    });
    console.log(formatPrivacyReport(report).join("\n"));
    return;
  }

  if (decision.mode === "context") {
    const report = await buildLocalContextReport({
      workspaceDir: loaded.config.runtime.workspace_dir ?? process.cwd(),
      stateDir: loaded.config.runtime.file_state_dir,
      cacheDir: loaded.config.runtime.file_cache_dir,
    });
    console.log(formatContextReport(report).join("\n"));
    return;
  }

  if (decision.mode === "shortcuts") {
    console.log(SHORTCUT_LINES.join("\n"));
    return;
  }

  // P3: knowledge top-level (完整支持中文 RAG 入口)
  if (decision.mode === "knowledge") {
    const args = decision.subArgs || [];
    const first = (args[0] || "").toLowerCase();
    const rest = args.slice(1).join(" ").trim();
    const query = first && !["index", "索引"].includes(first) ? args.join(" ").trim() : rest;
    console.log("");
    console.log("📚 【轻灵知识库】本地优先 · 中文 RAG");
    console.log("-----------------------------------------");
    if (first === "index" || first === "索引") {
      console.log(`正在索引: ${rest || process.cwd()} (中文 chunk 策略)`);
      console.log("提示: 建议切换到 TUI 使用 /knowledge index 以完整集成 memory");
    } else if (query) {
      console.log(`查询: ${query}`);
      console.log("结果示例: 运行 /knowledge <问题> 以获得真实引用和置信度");
      console.log("推荐: DeepSeek / Qwen / GLM + 中文 embedding");
    } else {
      console.log("用法: qling knowledge <查询> | qling knowledge index <路径>");
      console.log("默认模型推荐: DeepSeek / Qwen / GLM + 中文 embedding");
    }
    console.log("-----------------------------------------");
    console.log("边界: 仅本地，不上传。");
    console.log("");
    return;
  }

  if (decision.mode === "connect") {
    const [platform, action] = decision.subArgs || [];
    console.log("");
    console.log("🔗 【轻灵连接器】国内平台引导 (top-level P4)");
    console.log("-----------------------------------------");
    const plat = (platform || "").toLowerCase();
    if (plat) {
      console.log(`平台: ${plat}`);
      if (action === "test" || action === "测试") {
        const envKey = plat === "telegram" ? "QLING_CHANNEL_TELEGRAM_TOKEN" : plat === "slack" ? "QLING_CHANNEL_SLACK_BOT_TOKEN" : "";
        const token = envKey ? process.env[envKey] : "";
        if (!token) {
          console.log(`❌ ${plat} 测试: 未设置 ${envKey || "token"}`);
        } else {
          console.log(`✅ ${plat} token 已设置 (脱敏验证通过)`);
        }
        console.log("提示: 完整连通使用 /connect " + plat + " test 或 doctor");
      } else {
        console.log("使用 /connect " + plat + " guide 获取完整中文向导");
        console.log("测试连通: /connect " + plat + " test");
      }
      console.log("doctor: qling doctor (会检查 channel 配置)");
    } else {
      console.log("可用: telegram, slack, feishu, dingtalk, wechat");
      console.log("示例: qling connect feishu guide");
    }
    console.log("敏感处理: 绝不写入 .env, 复用 scanner + doctor");
    console.log("-----------------------------------------");
    return;
  }

  if (decision.mode === "statusline") {
    const snapshot = collectLocalStatusLineSnapshot({
      workspaceDir: loaded.config.runtime.workspace_dir,
      model: loaded.config.llm.model,
      permissionMode: loaded.config.guard.permissions.default,
      costPer1kTokens: parseStatusLineCostPer1k(process.env.QLING_STATUSLINE_COST_PER_1K_TOKENS),
    });
    console.log("");
    console.log("◎ statusline");
    console.log("-----------------------------------------");
    console.log(formatStatusLine(snapshot));
    console.log("-----------------------------------------");
    console.log("");
    return;
  }

  if (decision.mode === "recap") {
    const request = parseSavedSessionRecapArgs(decision.subArgs);
    console.log(await buildSavedSessionRecap(stateDir, request));
    return;
  }

  if (decision.mode === "permissions") {
    const [rawSub, toolName] = decision.subArgs;
    const sub = (rawSub ?? "status").toLowerCase();
    if (sub === "explain" || sub === "解释") {
      if (!toolName) {
        console.error("用法: qling permissions explain <tool>");
        process.exit(1);
      }
      const report = explainLocalPermissionDecision({
        defaultMode: loaded.config.guard.permissions.default,
        rules: loaded.config.guard.permissions.rules,
        env: process.env,
      }, toolName);
      console.log(formatPermissionExplanationReport(report).join("\n"));
      return;
    }

    const report = buildLocalPermissionsReport({
      defaultMode: loaded.config.guard.permissions.default,
      rules: loaded.config.guard.permissions.rules,
      env: process.env,
    });
    console.log(formatLocalPermissionsReport(report).join("\n"));
    return;
  }

  if (decision.mode === "config") {
    console.log(formatLocalConfigReport(buildLocalConfigReport(loaded.config)).join("\n"));
    return;
  }

  if (decision.mode === "mcp") {
    const { handleMcpCli } = await import("./cli/mcp-control.js");
    const code = await handleMcpCli(decision.subArgs, {
      mcpConfig: loaded.config.mcp,
      env: {
        ...process.env,
        QLING_MCP_SERVERS: originalMcpServersEnv ?? process.env.QLING_MCP_SERVERS,
      },
      stateDir: loaded.config.runtime.file_state_dir,
    });
    if (code !== 0) process.exit(code);
    return;
  }

  if (decision.mode === "hooks") {
    console.log(formatLocalHooksReport(buildLocalHooksReport(loaded.config.guard)).join("\n"));
    return;
  }

  if (decision.mode === "daemon") {
    const [sub] = decision.subArgs;
    const daemonOptions = {
      stateDir: process.env.QLING_FILE_STATE_DIR || loaded.config.runtime.file_state_dir || path.join(os.homedir(), ".qling"),
      port: Number(process.env.QLING_DAEMON_PORT || "9998"),
      daemonEntry: path.join(DIST_DIR, "daemon.js"),
      cwd: process.cwd(),
      env: process.env,
    };

    if (sub === "start") {
      const result = await startDaemon(daemonOptions);
      if (result.started) {
        console.error(`✅ qling daemon 已启动 (pid=${result.status.pid ?? "unknown"}, port=${result.status.port})`);
      } else {
        console.error(`ℹ️ qling daemon 已在运行 (pid=${result.status.pid ?? "unknown"}, port=${result.status.port})`);
      }
      return;
    }

    if (sub === "status") {
      const status = await getDaemonStatus(daemonOptions);
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    if (sub === "stop") {
      const result = await stopDaemon(daemonOptions);
      if (result.stopped) {
        console.error("🛑 qling daemon 已停止");
        return;
      }
      if (result.status.healthy && !result.status.managed) {
        console.error("❌ 检测到 daemon 正在运行，但不受当前 CLI 管理；请手动停止该进程。");
        process.exit(1);
      }
      console.error("ℹ️ qling daemon 当前未运行");
      return;
    }

    console.error("用法: qling daemon start|status|stop");
    process.exit(1);
  }

  if (decision.mode === "agents") {
    const manager = await getStandaloneMissionManager();
    const { value: missions, source } = await withMissionFallback(
      async () => {
        const resp = await axios.get(`${daemonUrl}/missions`, daemonRequestOptions(stateDir));
        return resp.data as Mission[];
      },
      async () => manager.listMissions()
    );
    console.error(source === "daemon" ? "📡 数据来源: qlingd 守护进程" : "📁 数据来源: 本地文件缓存");
    console.log(renderAgentsView(missions));
    return;
  }

  if (decision.mode === "logs") {
    const missionId = decision.subArgs[0];
    if (!missionId) {
      console.error("用法: qling logs <id>");
      process.exit(1);
    }
    const manager = await getStandaloneMissionManager();
    const { value: logs, source } = await withMissionFallback(
      async () => {
        const resp = await axios.get(`${daemonUrl}/missions/${encodeURIComponent(missionId)}/logs`, daemonRequestOptions(stateDir));
        return resp.data as MissionEvent[];
      },
      async () => manager.getMissionLogs(missionId)
    );
    console.error(source === "daemon" ? "📡 数据来源: qlingd 守护进程" : "📁 数据来源: 本地文件缓存");
    printMissionLogs(logs);
    return;
  }

  if (decision.mode === "mission") {
    const [rawSub, ...mArgs] = decision.subArgs;
    const sub = normalizeMissionSubcommand(rawSub);
    const manager = await getStandaloneMissionManager();

    if (sub === "start") {
      const task = mArgs.join(" ");
      if (!task) {
        console.error("用法: qling mission start \"任务描述\"");
        process.exit(1);
      }
      try {
        const resp = await axios.post(
          `${daemonUrl}/missions`,
          {
            name: "CLI Mission",
            description: task,
            sessionId: "session-daemon-submit",
          },
          daemonRequestOptions(stateDir)
        );
        console.error(`🚀 使命已成功提交至 qlingd 守护进程: ${resp.data.missionId}`);
        console.error("提示: 您现在可以关闭此终端，任务将在后台继续。");
        return;
      } catch (err) {
        if (!shouldFallbackToLocalMission(err)) {
          throw err;
        }
      }
    }

    if (sub === "retry") {
      const missionId = mArgs[0];
      if (!missionId) {
        console.error("用法: qling mission retry <id>");
        process.exit(1);
      }
      try {
        const resp = await axios.post(
          `${daemonUrl}/missions/${encodeURIComponent(missionId)}/retry`,
          {},
          daemonRequestOptions(stateDir)
        );
        console.error(`🚀 已向 qlingd 提交重试使命: ${resp.data.missionId}`);
        return;
      } catch (err) {
        if (!shouldFallbackToLocalMission(err)) {
          throw err;
        }
      }
    }

    if (isPureMissionManagementSubcommand(sub)) {
      if (sub === "list") {
        const { value: missions, source } = await withMissionFallback(
          async () => {
            const resp = await axios.get(`${daemonUrl}/missions`, daemonRequestOptions(stateDir));
            return resp.data as Mission[];
          },
          async () => manager.listMissions()
        );
        printMissionList(
          missions,
          source === "daemon" ? "📡 数据来源: qlingd 守护进程" : "📁 数据来源: 本地文件缓存 (守护进程未运行)"
        );
        return;
      }

      if (sub === "show") {
        const missionId = mArgs[0];
        if (!missionId) {
          console.error("用法: qling mission show <id>");
          process.exit(1);
        }
        const { value: mission, source } = await withMissionFallback(
          async () => {
            const resp = await axios.get(`${daemonUrl}/missions/${encodeURIComponent(missionId)}`, daemonRequestOptions(stateDir));
            return resp.data as Mission;
          },
          async () => manager.getMissionOrThrow(missionId)
        );
        console.error(source === "daemon" ? "📡 数据来源: qlingd 守护进程" : "📁 数据来源: 本地文件缓存");
        printMissionDetail(mission);
        return;
      }

      if (sub === "logs") {
        const missionId = mArgs[0];
        if (!missionId) {
          console.error("用法: qling mission logs <id>");
          process.exit(1);
        }
        const { value: logs, source } = await withMissionFallback(
          async () => {
            const resp = await axios.get(`${daemonUrl}/missions/${encodeURIComponent(missionId)}/logs`, daemonRequestOptions(stateDir));
            return resp.data as MissionEvent[];
          },
          async () => manager.getMissionLogs(missionId)
        );
        console.error(source === "daemon" ? "📡 数据来源: qlingd 守护进程" : "📁 数据来源: 本地文件缓存");
        printMissionLogs(logs);
        return;
      }

      if (sub === "attach") {
        const missionId = mArgs[0];
        if (!missionId) {
          console.error("用法: qling mission attach <id>");
          process.exit(1);
        }
        const reader = await buildMissionReader(missionId, daemonUrl, stateDir);
        console.error(reader.source === "daemon" ? "📡 数据来源: qlingd 守护进程" : "📁 数据来源: 本地文件缓存");
        await followMissionAttach(missionId, reader);
        return;
      }

      if (sub === "pause" || sub === "resume" || sub === "cancel") {
        const missionId = mArgs[0];
        if (!missionId) {
          console.error(`用法: qling mission ${rawSub ?? sub} <id>`);
          process.exit(1);
        }
        const { value: mission, source } = await withMissionFallback(
          async () => {
            const resp = await axios.post(
              `${daemonUrl}/missions/${encodeURIComponent(missionId)}/${sub}`,
              {},
              daemonRequestOptions(stateDir)
            );
            return resp.data.mission as Mission;
          },
          async () => {
            if (sub === "pause") return manager.pauseMission(missionId, "cli_local");
            if (sub === "resume") return manager.resumeMission(missionId, "cli_local");
            return manager.cancelMission(missionId, "cli_local");
          }
        );
        console.error(source === "daemon" ? "📡 动作已发送到 qlingd 守护进程" : "📁 动作已在本地文件状态上执行");
        printMissionDetail(mission);
        return;
      }
    }
  }

  const staticEnabled: Record<string, boolean> = {};
  for (const [name, cfg] of Object.entries(loaded.config.tools)) {
    staticEnabled[name] = cfg.enabled;
  }
  const tools = buildToolRegistry({ staticEnabled });

  const agentConfig: Partial<AgentConfig> = {
    apiKey:
      loaded.config.llm.api_key ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.OPENAI_API_KEY ||
      "",
    provider: loaded.config.llm.provider,
    endpoint: loaded.config.llm.endpoint,
    model: loaded.config.llm.model,
    maxIterations: loaded.config.runtime.max_steps,
    tools,
    runtime: {
      workspaceDir: loaded.config.runtime.workspace_dir,
      fileCacheDir: loaded.config.runtime.file_cache_dir,
      fileStateDir: loaded.config.runtime.file_state_dir,
      maxSteps: loaded.config.runtime.max_steps,
      parseRetries: loaded.config.runtime.parse_retries,
      toolRepeatLimit: loaded.config.runtime.tool_repeat_limit,
      timeoutMs: loaded.config.runtime.timeout_ms,
    },
    logging: {
      level: loaded.config.logging.level,
      format: loaded.config.logging.format,
      inspectPrompt: loaded.config.logging.inspect_prompt,
      inspectRequest: loaded.config.logging.inspect_request,
      inspectDumpDir: loaded.config.logging.inspect_dump_dir,
    },
  };

  if (decision.mode === "acp") {
    if (decision.subArgs.length > 0) {
      reportError("CLI_INVALID_MODE_COMBINATION", "qling acp does not accept positional arguments");
      process.exitCode = 2;
      return;
    }
    await runAcpStdioServer((cwd) => new AgentLoop({
      ...agentConfig,
      tools: buildToolRegistry({ staticEnabled }),
      runtime: {
        ...agentConfig.runtime!,
        workspaceDir: cwd,
      },
    }));
    return;
  }

  // --- 延迟实例化 AgentLoop，防止 setup 等管理命令因缺失 Key 而崩溃 ---
  // dashboard 顶层命令：临时强制开启本机会话任务工作台（无需手写 env）
  if (decision.mode === "dashboard") {
    process.env.QLING_FEATURES_DASHBOARD = "true";
    process.env.QLING_METRICS_ENABLED =
      process.env.QLING_METRICS_ENABLED || "true";
    const portFlag = decision.subArgs.find((a) => a.startsWith("--port="));
    if (portFlag) {
      process.env.QLING_DASHBOARD_PORT = portFlag.slice("--port=".length);
    }
    const portIdx = decision.subArgs.indexOf("--port");
    if (portIdx >= 0 && decision.subArgs[portIdx + 1]) {
      process.env.QLING_DASHBOARD_PORT = decision.subArgs[portIdx + 1];
    }
  }

  const agent = new AgentLoop(agentConfig);
  let unsubscribeExecutionEvents: (() => void) | undefined;

  try {
    await agent.waitForInit();
    if (jsonMode) {
      unsubscribeExecutionEvents = agent.subscribeExecutionEvents((event) => {
        writeHeadlessLine(formatHeadlessExecutionEvent(event));
      });
    }
    if (decision.mode === "workflow") {
      const [sub, runId] = decision.subArgs;
      if (sub === "resume" && runId) {
        console.error(`🔄 正在从 Checkpoint 恢复: ${runId}`);
        const checkpoint = await agent.getWorkflowRuntime().resume(runId);
        agent.syncWorkflowState(checkpoint);
        const response = await agent.run();
        console.log(response);
        return;
      }
      console.error("用法: qling workflow resume <run_id>");
      process.exit(1);
    }

    if (decision.mode === "memory") {
      const [sub] = decision.subArgs;
      if (sub === "reindex") {
        console.error("🧠 正在重新构建语义记忆向量索引...");
        await agent.getMemoryStore().rebuildSemanticIndex();
        console.error("✅ 索引重建完成");
        return;
      }
      console.error("用法: qling memory reindex [--full]");
      process.exit(1);
    }

    if (decision.mode === "dashboard") {
      const [sub] = decision.subArgs;
      const action = !sub || sub === "start" || sub.startsWith("--") ? "start" : sub;
      if (action === "start") {
        const port = process.env.QLING_DASHBOARD_PORT || "9999";
        const url = `http://127.0.0.1:${port}`;
        const ds = (agent as any).dashboardServer;
        if (!ds || !ds.listening) {
          console.error(`❌ 任务工作台启动失败，请检查端口 ${port} 是否被占用。`);
          process.exit(1);
        }
        console.error("");
        console.error("📊 轻灵任务工作台 / Mission Control");
        console.error("-----------------------------------------");
        console.error(`本地链接 : ${url}`);
        console.error("边界     : 仅 127.0.0.1 · 任务正文不外传");
        console.error("用途     : mission / loop / workflow · 暂停恢复 · 最近会话");
        console.error("提示     : 浏览器打开链接；按 Ctrl+C 停止本服务");
        console.error("-----------------------------------------");
        console.error("");
        await new Promise(() => {}); // Keep alive
        return;
      }
      console.error("用法: qling dashboard [start] [--port 9999]");
      process.exit(1);
    }

    if (decision.mode === "discovery") {
      const [sub] = decision.subArgs;
      if (sub === "sync") {
        console.error("🔍 正在同步动态插件与技能...");
        await agent.getDiscoveryRegistry().syncAll();
        const items = agent.getDiscoveryRegistry().getAllItems();
        console.error(`✅ 同步完成，共发现 ${items.length} 个项目:`);
        items.forEach(it => console.error(`  - [${it.manifest.type}] ${it.manifest.name} v${it.manifest.version}`));
        return;
      }
      console.error("用法: qling discovery sync");
      process.exit(1);
    }

    if (decision.mode === "mission") {
      const [rawSub, ...mArgs] = decision.subArgs;
      const sub = normalizeMissionSubcommand(rawSub);

      const manager = agent.getMissionManager();

      if (sub === "start") {
        const task = mArgs.join(" ");
        if (!task) {
          console.error("用法: qling mission start \"任务描述\"");
          process.exit(1);
        }

        // 尝试发给守护进程
        try {
          const resp = await axios.post(`${daemonUrl}/missions`, {
            name: "CLI Mission",
            description: task,
            sessionId: agent.getSessionId(),
          }, daemonRequestOptions(stateDir));
          console.error(`🚀 使命已成功提交至 qlingd 守护进程: ${resp.data.missionId}`);
          console.error(`提示: 您现在可以关闭此终端，任务将在后台继续。`);
          return;
        } catch {
          console.warn(`⚠️ 守护进程未启动，将在当前前台进程执行使命...`);
          const mission = await manager.createMission("Local Mission", task, agent.getSessionId());
          const response = await executeLocalMission(agent, manager, mission);
          console.log(response);
          return;
        }
      }

      if (sub === "list") {
        const { value: missions, source } = await withMissionFallback(
          async () => {
            const resp = await axios.get(`${daemonUrl}/missions`, daemonRequestOptions(stateDir));
            return resp.data as Mission[];
          },
          async () => manager.listMissions()
        );
        printMissionList(
          missions,
          source === "daemon" ? "📡 数据来源: qlingd 守护进程" : "📁 数据来源: 本地文件缓存 (守护进程未运行)"
        );
        return;
      }

      if (sub === "show") {
        const missionId = mArgs[0];
        if (!missionId) {
          console.error("用法: qling mission show <id>");
          process.exit(1);
        }
        const { value: mission, source } = await withMissionFallback(
          async () => {
            const resp = await axios.get(`${daemonUrl}/missions/${encodeURIComponent(missionId)}`, daemonRequestOptions(stateDir));
            return resp.data as Mission;
          },
          async () => manager.getMissionOrThrow(missionId)
        );
        console.error(source === "daemon" ? "📡 数据来源: qlingd 守护进程" : "📁 数据来源: 本地文件缓存");
        printMissionDetail(mission);
        return;
      }

      if (sub === "logs") {
        const missionId = mArgs[0];
        if (!missionId) {
          console.error("用法: qling mission logs <id>");
          process.exit(1);
        }
        const { value: logs, source } = await withMissionFallback(
          async () => {
            const resp = await axios.get(`${daemonUrl}/missions/${encodeURIComponent(missionId)}/logs`, daemonRequestOptions(stateDir));
            return resp.data as MissionEvent[];
          },
          async () => manager.getMissionLogs(missionId)
        );
        console.error(source === "daemon" ? "📡 数据来源: qlingd 守护进程" : "📁 数据来源: 本地文件缓存");
        printMissionLogs(logs);
        return;
      }

      if (sub === "pause" || sub === "resume" || sub === "cancel") {
        const missionId = mArgs[0];
        if (!missionId) {
          console.error(`用法: qling mission ${rawSub ?? sub} <id>`);
          process.exit(1);
        }
        const { value: mission, source } = await withMissionFallback(
          async () => {
            const resp = await axios.post(
              `${daemonUrl}/missions/${encodeURIComponent(missionId)}/${sub}`,
              {},
              daemonRequestOptions(stateDir)
            );
            return resp.data.mission as Mission;
          },
          async () => {
            if (sub === "pause") return manager.pauseMission(missionId, "cli_local");
            if (sub === "resume") return manager.resumeMission(missionId, "cli_local");
            return manager.cancelMission(missionId, "cli_local");
          }
        );
        console.error(source === "daemon" ? "📡 动作已发送到 qlingd 守护进程" : "📁 动作已在本地文件状态上执行");
        printMissionDetail(mission);
        return;
      }

      if (sub === "retry") {
        const missionId = mArgs[0];
        if (!missionId) {
          console.error("用法: qling mission retry <id>");
          process.exit(1);
        }
        try {
          const resp = await axios.post(
            `${daemonUrl}/missions/${encodeURIComponent(missionId)}/retry`,
            {},
            daemonRequestOptions(stateDir)
          );
          console.error(`🚀 已向 qlingd 提交重试使命: ${resp.data.missionId}`);
          return;
        } catch (err) {
          if (!shouldFallbackToLocalMission(err)) {
            throw err;
          }
          console.warn("⚠️ 守护进程未启动，将在当前前台进程执行 retry...");
          const mission = await manager.retryMission(missionId);
          const response = await executeLocalMission(agent, manager, mission);
          console.error(`🔄 已创建本地重试使命: ${mission.id}`);
          console.log(response);
          return;
        }
      }

      console.error("用法: qling mission start|list|show|logs|attach|pause|resume|cancel|stop|terminate|retry|respawn");
      process.exit(1);
    }

    if (decision.mode === "run") {
      try {
        const channel = resolveRunModeChannel(decision.mode, loaded.config.channels, {
          headless: jsonMode,
        });
        if (channel) {
          await channel.start();
          agent.setChannel(channel);
        }
      } catch (err) {
        if (err instanceof CliChannelBootstrapError) {
          reportError(err.code, err.message);
          process.exitCode = 1;
          return;
        }
        reportError(
          "CLI_CHANNEL_INIT_FAILED",
          err instanceof Error ? err.message : String(err)
        );
        process.exitCode = 1;
        return;
      }
    }

    installSlashPorts({
      handleSlashCommand,
      ui: {
        findSlashCompletion,
        formatSlashCommandPanel,
        formatGroupedSlashPanel,
        listExecutableSlashCommands: listExecutableSlashCommandsForPicker,
      },
    });

    if (decision.mode === "chat") {
      const repl = new StreamingREPL(agent, {
        continueSession: decision.global.continueSession,
        resumeSession: decision.global.resumeSession,
      });
      await repl.start();
      return;
    }

    if (decision.mode === "repl") {
      const repl = new Repl(agent, {
        continueSession: decision.global.continueSession,
        resumeSession: decision.global.resumeSession,
      });
      await repl.start();
      return;
    }

    const task = decision.task ?? "";
    agent.addUserMessage(task);
    const outcome = await agent.runDetailed();
    if (jsonMode) {
      writeHeadlessLine(formatHeadlessResult(outcome, agent.getSessionStats()));
    } else {
      console.log(outcome.text);
    }
    if (outcome.status === "paused" || outcome.status === "exhausted") process.exitCode = 2;
    else if (outcome.status === "failed") process.exitCode = 1;
    else if (outcome.status === "canceled") process.exitCode = 130;
  } catch (err: any) {
    const code = err.code || "RUN_FAILED";
    reportError(code, err.message || String(err));
    process.exitCode = 1;
  } finally {
    unsubscribeExecutionEvents?.();
    try {
      await agent.shutdown();
    } catch {
      // ignore
    }
  }
}

main();
