import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";

import { SessionGoalManager, type SessionGoalRunner, type SessionGoalState } from "./session/session-goal-manager.js";
import { SessionRegistry, type SavedSessionSummary } from "./session/session-registry.js";

export interface LocalSessionGoal {
  sessionId: string;
  filePath: string;
  goal: SessionGoalState;
}

export interface SessionGoalReport {
  stateDir: string;
  goalsDir: string;
  sessionRef: string | null;
  totalGoals: number;
  goals: LocalSessionGoal[];
  warnings: string[];
}

export interface SessionGoalMutation {
  sessionId: string;
  sessionName: string;
  workspaceDir: string | null;
  goal: SessionGoalState;
}

export interface SetLocalSessionGoalOptions {
  sessionRef?: string;
  runner?: SessionGoalRunner;
  clock?: () => number;
}

export interface ClearLocalSessionGoalOptions {
  sessionRef?: string;
  clock?: () => number;
}

interface SessionTarget {
  sessionId: string;
  name: string;
  workspaceDir: string | null;
  turnCount: number;
  tokens: number;
}

export async function listLocalSessionGoals(
  stateDir: string,
  options: { sessionRef?: string } = {}
): Promise<SessionGoalReport> {
  const goalsDir = path.join(stateDir, "session-goals");
  const warnings: string[] = [];
  const sessionRef = normalizeOptionalRef(options.sessionRef);

  if (sessionRef) {
    const sessionId = await resolveStatusSessionId(stateDir, sessionRef);
    const goal = await readGoalFile(goalsDir, sessionId, warnings);
    return {
      stateDir,
      goalsDir,
      sessionRef,
      totalGoals: goal ? 1 : 0,
      goals: goal ? [goal] : [],
      warnings,
    };
  }

  if (!existsSync(goalsDir)) {
    return {
      stateDir,
      goalsDir,
      sessionRef: null,
      totalGoals: 0,
      goals: [],
      warnings,
    };
  }

  const files = (await fs.readdir(goalsDir)).filter((file) => file.endsWith(".json")).sort();
  const goals: LocalSessionGoal[] = [];
  for (const file of files) {
    const sessionId = path.basename(file, ".json");
    const goal = await readGoalFile(goalsDir, sessionId, warnings);
    if (goal) goals.push(goal);
  }

  goals.sort(compareGoals);
  return {
    stateDir,
    goalsDir,
    sessionRef: null,
    totalGoals: goals.length,
    goals,
    warnings,
  };
}

export async function setLocalSessionGoal(
  stateDir: string,
  condition: string,
  options: SetLocalSessionGoalOptions = {}
): Promise<SessionGoalMutation> {
  const normalizedCondition = condition.trim();
  if (!normalizedCondition) {
    throw new Error("goal condition is required");
  }

  const target = await resolveSessionTarget(stateDir, options.sessionRef);
  const runner = options.runner ?? "daemon";
  const manager = new SessionGoalManager({
    stateDir,
    sessionId: target.sessionId,
    clock: options.clock,
  });
  await manager.init();
  const goal = await manager.setGoal(
    normalizedCondition,
    {
      turnCount: target.turnCount,
      tokens: target.tokens,
    },
    {
      runner,
      pending: runner === "daemon",
    }
  );

  return {
    sessionId: target.sessionId,
    sessionName: target.name,
    workspaceDir: target.workspaceDir,
    goal,
  };
}

export async function clearLocalSessionGoal(
  stateDir: string,
  options: ClearLocalSessionGoalOptions = {}
): Promise<SessionGoalMutation> {
  const target = await resolveSessionTarget(stateDir, options.sessionRef);
  const manager = new SessionGoalManager({
    stateDir,
    sessionId: target.sessionId,
    clock: options.clock,
  });
  await manager.init();
  const goal = await manager.clearGoal("cli_clear");

  return {
    sessionId: target.sessionId,
    sessionName: target.name,
    workspaceDir: target.workspaceDir,
    goal,
  };
}

export function formatSessionGoalReport(report: SessionGoalReport): string[] {
  const lines = [
    "◎ 本地目标列表",
    "-----------------------------------------",
    `State dir : ${report.stateDir}`,
    `Goals    : ${report.goalsDir}`,
    `Count    : ${report.goals.length}/${report.totalGoals}`,
  ];
  if (report.sessionRef) {
    lines.push(`Target   : ${report.sessionRef}`);
  }

  if (report.goals.length === 0) {
    lines.push("(无本地目标。可使用 `qling goal set \"完成条件\"` 创建 daemon goal。)");
  } else {
    lines.push("");
    for (const item of report.goals) {
      lines.push(`- [${item.goal.status.toUpperCase()}] ${item.sessionId}`);
      lines.push(`  Runner  : ${item.goal.runner ?? "session"} | pending=${item.goal.pending ? "yes" : "no"}`);
      lines.push(`  条件    : ${item.goal.condition || "(空)"}`);
      lines.push(`  创建    : ${formatTimestamp(item.goal.createdAt)} | 更新: ${formatTimestamp(item.goal.updatedAt)}`);
      lines.push(`  评估    : ${item.goal.evaluatedTurns ?? 0} | 最近原因: ${item.goal.lastReason ?? "-"}`);
    }
  }

  for (const warning of report.warnings) {
    lines.push(`⚠️ ${warning}`);
  }

  lines.push("-----------------------------------------");
  lines.push("说明: 只读取本地 goal 状态与会话摘要，不输出会话正文、不联网、不调用模型。");
  return lines;
}

export function formatSessionGoalMutation(
  action: "set" | "clear",
  result: SessionGoalMutation
): string[] {
  const title = action === "set" ? "◎ 已设置本地目标" : "◎ 已清除本地目标";
  const lines = [
    title,
    "-----------------------------------------",
    `Session : ${result.sessionId}`,
    `Name    : ${result.sessionName}`,
    `状态    : ${result.goal.status}`,
    `Runner  : ${result.goal.runner ?? "session"} | pending=${result.goal.pending ? "yes" : "no"}`,
    `条件    : ${result.goal.condition || "(空)"}`,
    `更新    : ${formatTimestamp(result.goal.updatedAt)}`,
  ];
  if (result.workspaceDir) {
    lines.push(`Workspace: ${result.workspaceDir}`);
  }
  lines.push("-----------------------------------------");
  lines.push(
    action === "set"
      ? "说明: 已写入本地 session-goals；默认 daemon runner，需 qlingd 运行后继续推进。"
      : "说明: 仅更新本地 session-goals 状态，不删除历史记录。"
  );
  return lines;
}

async function resolveStatusSessionId(stateDir: string, sessionRef: string): Promise<string> {
  if (sessionRef === "latest") {
    return (await resolveSessionTarget(stateDir, sessionRef)).sessionId;
  }
  const registry = new SessionRegistry({ stateDir });
  const sessions = await registry.list();
  const normalized = normalizeRef(sessionRef);
  const matched = sessions.find(
    (session) => normalizeRef(session.name) === normalized || session.sessionId === sessionRef
  );
  return matched?.sessionId ?? normalized;
}

async function resolveSessionTarget(
  stateDir: string,
  sessionRef?: string
): Promise<SessionTarget> {
  const registry = new SessionRegistry({ stateDir });
  const sessions = await registry.list();
  if (sessions.length === 0) {
    throw new Error("no saved sessions found; start or resume a chat session first");
  }

  const normalized = normalizeOptionalRef(sessionRef);
  const summary =
    !normalized || normalized === "latest"
      ? sessions[0]
      : findSession(sessions, normalized);
  if (!summary) {
    throw new Error(`session not found: ${sessionRef}`);
  }

  return {
    sessionId: summary.sessionId,
    name: summary.name,
    workspaceDir: summary.workspaceDir,
    turnCount: summary.turnCount,
    tokens: summary.sessionTokens,
  };
}

function findSession(
  sessions: SavedSessionSummary[],
  sessionRef: string
): SavedSessionSummary | null {
  const normalized = normalizeRef(sessionRef);
  return (
    sessions.find(
      (session) => normalizeRef(session.name) === normalized || session.sessionId === sessionRef
    ) ?? null
  );
}

async function readGoalFile(
  goalsDir: string,
  sessionId: string,
  warnings: string[]
): Promise<LocalSessionGoal | null> {
  const filePath = path.join(goalsDir, `${normalizeRef(sessionId)}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as SessionGoalState;
    return {
      sessionId: normalizeRef(sessionId),
      filePath,
      goal: {
        ...parsed,
        runner: parsed.runner ?? "session",
        pending: parsed.pending ?? false,
      },
    };
  } catch (err) {
    warnings.push(`${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function normalizeOptionalRef(value?: string): string | null {
  if (!value || !value.trim()) return null;
  return normalizeRef(value.trim());
}

function normalizeRef(value: string): string {
  return path.basename(value).replace(/\.json$/i, "");
}

function compareGoals(left: LocalSessionGoal, right: LocalSessionGoal): number {
  const updated = (right.goal.updatedAt ?? 0) - (left.goal.updatedAt ?? 0);
  if (updated !== 0) return updated;
  return left.sessionId.localeCompare(right.sessionId);
}

function formatTimestamp(ts?: number): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}
