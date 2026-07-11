import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";

import type { SessionTask } from "./session/session-scheduler.js";

const DEFAULT_TASK_COUNT = 20;
const MAX_TASK_COUNT = 100;

export interface LocalSessionTask extends SessionTask {
  sessionId: string;
  filePath: string;
}

export interface SessionTaskReport {
  tasksDir: string;
  totalFiles: number;
  totalTasks: number;
  shownTasks: number;
  tasks: LocalSessionTask[];
  warnings: string[];
}

export function parseSessionTaskCount(value?: string): number {
  if (!value) return DEFAULT_TASK_COUNT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TASK_COUNT;
  return Math.min(parsed, MAX_TASK_COUNT);
}

export async function listLocalSessionTasks(
  stateDir: string,
  options: { count?: number; maxCount?: number } = {}
): Promise<SessionTaskReport> {
  const tasksDir = path.join(stateDir, "session-tasks");
  const maxCount = Math.max(1, Math.floor(options.maxCount ?? MAX_TASK_COUNT));
  const count = Math.min(
    Math.max(1, Math.floor(options.count ?? DEFAULT_TASK_COUNT)),
    maxCount
  );
  const warnings: string[] = [];

  if (!existsSync(tasksDir)) {
    return {
      tasksDir,
      totalFiles: 0,
      totalTasks: 0,
      shownTasks: 0,
      tasks: [],
      warnings,
    };
  }

  const files = (await fs.readdir(tasksDir))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const tasks: LocalSessionTask[] = [];

  for (const file of files) {
    const filePath = path.join(tasksDir, file);
    const sessionId = path.basename(file, ".json");
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        warnings.push(`${file}: expected task array`);
        continue;
      }
      for (const task of parsed) {
        if (!task || typeof task.id !== "string") {
          warnings.push(`${file}: skipped task without id`);
          continue;
        }
        tasks.push({
          ...task,
          sessionId,
          filePath,
          runner: task.runner ?? "session",
        } as LocalSessionTask);
      }
    } catch (err) {
      warnings.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const sorted = tasks.sort(compareTasks);
  const shown = sorted.slice(0, count);

  return {
    tasksDir,
    totalFiles: files.length,
    totalTasks: sorted.length,
    shownTasks: shown.length,
    tasks: shown,
    warnings,
  };
}

export async function cancelLocalSessionTask(
  stateDir: string,
  taskId: string,
  options: { clock?: () => number } = {}
): Promise<LocalSessionTask> {
  const tasksDir = path.join(stateDir, "session-tasks");
  if (!existsSync(tasksDir)) {
    throw new Error(`session task not found: ${taskId}`);
  }

  const files = (await fs.readdir(tasksDir))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const now = options.clock?.() ?? Date.now();

  for (const file of files) {
    const filePath = path.join(tasksDir, file);
    const sessionId = path.basename(file, ".json");
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) continue;

    const index = parsed.findIndex((task) => task?.id === taskId);
    if (index < 0) continue;

    const current = parsed[index] as SessionTask;
    const next =
      current.status === "canceled"
        ? { ...current, runner: current.runner ?? "session" }
        : {
            ...current,
            runner: current.runner ?? "session",
            status: "canceled" as const,
            pending: false,
            updatedAt: now,
          };
    parsed[index] = next;
    await fs.writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");
    return {
      ...next,
      sessionId,
      filePath,
    };
  }

  throw new Error(`session task not found: ${taskId}`);
}

export function formatSessionTaskReport(report: SessionTaskReport): string[] {
  const lines = [
    "📋 本地任务列表",
    "-----------------------------------------",
    `状态目录 : ${report.tasksDir}`,
    `任务文件 : ${report.totalFiles}`,
    `任务总数 : ${report.totalTasks}`,
    `显示数量 : ${report.shownTasks}`,
  ];

  if (report.tasks.length === 0) {
    lines.push("(无本地任务。可在 TUI 中使用 /loop 创建。)");
  } else {
    for (const task of report.tasks) {
      lines.push(`- [${String(task.status).toUpperCase()}] ${task.id}`);
      lines.push(`  Session : ${task.sessionId}`);
      lines.push(
        `  Runner  : ${task.runner ?? "session"} | pending=${task.pending ? "yes" : "no"} | mode=${task.mode}`
      );
      lines.push(
        `  Interval: ${formatInterval(task.intervalMs)} | Next: ${formatTimestamp(task.nextRunAt)} | Last: ${formatTimestamp(task.lastRunAt)}`
      );
      lines.push(`  Updated : ${formatTimestamp(task.updatedAt)}`);
      lines.push(`  Prompt  : ${summarizePrompt(task.prompt)}`);
    }
  }

  for (const warning of report.warnings) {
    lines.push(`⚠️ ${warning}`);
  }

  lines.push("-----------------------------------------");
  lines.push("说明: 只读取本地 session-tasks 元数据，不读取会话正文、不联网、不调用模型。");
  return lines;
}

export function formatCanceledSessionTask(task: LocalSessionTask): string[] {
  return [
    "🛑 已取消本地任务",
    "-----------------------------------------",
    `任务 ID : ${task.id}`,
    `Session : ${task.sessionId}`,
    `状态    : ${task.status}`,
    `Runner  : ${task.runner ?? "session"}`,
    `Updated : ${formatTimestamp(task.updatedAt)}`,
    "-----------------------------------------",
    "说明: 仅更新本地 session-tasks 状态文件；daemon/session 会在下一次读取时观察到取消状态。",
  ];
}

function compareTasks(a: LocalSessionTask, b: LocalSessionTask): number {
  const updated = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  if (updated !== 0) return updated;
  const created = (b.createdAt ?? 0) - (a.createdAt ?? 0);
  if (created !== 0) return created;
  return a.id.localeCompare(b.id);
}

function formatTimestamp(ts?: number): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function formatInterval(ms?: number): string {
  if (!Number.isFinite(ms) || !ms) return "-";
  if (ms % (24 * 60 * 60 * 1000) === 0) return `${ms / (24 * 60 * 60 * 1000)}d`;
  if (ms % (60 * 60 * 1000) === 0) return `${ms / (60 * 60 * 1000)}h`;
  if (ms % (60 * 1000) === 0) return `${ms / (60 * 1000)}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

function summarizePrompt(prompt: string): string {
  const normalized = String(prompt ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "(空)";
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77)}...`;
}
