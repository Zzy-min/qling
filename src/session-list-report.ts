import { join } from "path";
import { SessionRegistry, type SavedSessionSummary } from "./session/session-registry.js";

const DEFAULT_SESSION_COUNT = 20;
const MAX_SESSION_COUNT = 100;

export interface SessionListReport {
  stateDir: string;
  sessionsDir: string;
  sessions: SavedSessionSummary[];
  total: number;
  requestedCount: number;
  truncated: boolean;
}

export interface SessionListOptions {
  count?: string | number;
}

export function parseSessionListCount(value?: string | number): number {
  if (value === undefined || value === null || value === "") return DEFAULT_SESSION_COUNT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SESSION_COUNT;
  return Math.min(Math.floor(parsed), MAX_SESSION_COUNT);
}

function formatTime(value: string): string {
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? value : new Date(ts).toLocaleString();
}

export async function listLocalSessions(
  stateDir: string,
  options: SessionListOptions = {}
): Promise<SessionListReport> {
  const requestedCount = parseSessionListCount(options.count);
  const registry = new SessionRegistry({ stateDir });
  const allSessions = await registry.list();

  return {
    stateDir,
    sessionsDir: join(stateDir, "sessions"),
    sessions: allSessions.slice(0, requestedCount),
    total: allSessions.length,
    requestedCount,
    truncated: allSessions.length > requestedCount,
  };
}

export function formatSessionListReport(report: SessionListReport): string[] {
  const lines = [
    "",
    "🗂️ 本地会话列表",
    "-----------------------------------------",
    `State dir : ${report.stateDir}`,
    `Sessions  : ${report.sessionsDir}`,
    `Count     : ${report.sessions.length}/${report.total}`,
  ];

  if (!report.sessions.length) {
    lines.push("(无)");
    lines.push("-----------------------------------------");
    lines.push("说明      : 仅读取本地会话快照摘要，不调用模型、不联网。");
    lines.push("");
    return lines;
  }

  if (report.truncated) {
    lines.push(`Limit     : 显示最近 ${report.requestedCount} 条`);
  }
  lines.push("");

  report.sessions.forEach((session, index) => {
    lines.push(`${index + 1}. ${session.name} | ${session.sessionId}`);
    lines.push(
      `   更新     : ${formatTime(session.updatedAt)} | turns=${session.turnCount} | messages=${session.messageCount} | tokens=${session.sessionTokens.toLocaleString()}`
    );
    lines.push(`   压缩     : ${session.compactionCount}`);
    lines.push(`   Workspace: ${session.workspaceDir ?? "-"}`);
  });

  lines.push("-----------------------------------------");
  lines.push("说明      : 输出只包含本地摘要字段，不输出消息正文；不调用模型、不联网。");
  lines.push("");
  return lines;
}
