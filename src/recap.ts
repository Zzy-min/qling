import type { SlashCommandContext } from "./commands/runtime.js";
import { SessionRegistry, type SavedSessionSnapshot } from "./session/session-registry.js";

interface RecapMessage {
  role?: string;
  content?: unknown;
}

interface RecapStats {
  sessionId?: string;
  turnCount?: number;
  tokens?: number;
  compactions?: number;
}

interface LocalRecapInput {
  stats: RecapStats;
  workspaceDir?: string;
  goalStatus?: { status?: string; condition?: string } | null;
  activeTasks: Array<{ id?: string; status?: string; prompt?: string }>;
  messages: RecapMessage[];
  limit: number;
}

export interface SavedSessionRecapRequest {
  sessionRef: string;
  count: number;
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function compactOneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 1)) + "...";
}

export function resolveRecapLimit(value?: string): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 6;
  return Math.min(parsed, 20);
}

function isCountArg(value: string | undefined): boolean {
  if (!value) return false;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && String(parsed) === value.trim();
}

export function parseSavedSessionRecapArgs(args: string[] = []): SavedSessionRecapRequest {
  const [first, second] = args;
  if (!first) {
    return { sessionRef: "latest", count: resolveRecapLimit(undefined) };
  }
  if (isCountArg(first)) {
    return { sessionRef: "latest", count: resolveRecapLimit(first) };
  }
  return {
    sessionRef: first,
    count: resolveRecapLimit(second),
  };
}

export function formatRecapMessage(message: RecapMessage, maxLength = 120): string {
  const role = compactOneLine(String(message.role || "unknown")) || "unknown";
  const content = truncate(compactOneLine(stringifyContent(message.content ?? "")), maxLength);
  return `${role}: ${content}`;
}

export function formatLocalRecap(input: LocalRecapInput): string {
  const stats = input.stats ?? {};
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const recent = messages.slice(-Math.max(0, input.limit));
  const goal = input.goalStatus?.status
    ? `${input.goalStatus.status}${input.goalStatus.condition ? ` (${input.goalStatus.condition})` : ""}`
    : "none";
  const lines = [
    "",
    "📌 【本地会话回顾】",
    "-----------------------------------------",
    `session=${stats.sessionId || "-"}  turns=${Number(stats.turnCount ?? 0)}  tokens=${Number(stats.tokens ?? 0).toLocaleString()}  compactions=${Number(stats.compactions ?? 0)}`,
    `goal=${goal}  tasks=${input.activeTasks.length}`,
    `workspace=${input.workspaceDir || "-"}`,
    "最近消息:",
  ];

  if (recent.length === 0) {
    lines.push("  最近消息: 无");
  } else {
    for (const message of recent) {
      lines.push(`  ${formatRecapMessage(message)}`);
    }
  }

  lines.push("-----------------------------------------");
  lines.push("说明: 本回顾只读取当前本地会话状态，不调用模型、不联网、不写远端。");
  lines.push("");
  return lines.join("\n");
}

function formatMissingSavedSessionRecap(stateDir: string, sessionRef: string): string {
  const lines = [
    "",
    "📌 【本地会话回顾】",
    "-----------------------------------------",
    `stateDir=${stateDir}`,
    `session=${sessionRef || "latest"}`,
    "未找到本地会话快照。",
    "提示: 先完成一次交互会话，或使用 `qling sessions` / `/sessions` 查看已保存快照。",
    "-----------------------------------------",
    "说明: 本命令只读取本地已保存会话快照，不调用模型、不联网、不写远端。",
    "",
  ];
  return lines.join("\n");
}

function formatSavedSessionRecap(snapshot: SavedSessionSnapshot, limit: number): string {
  const text = formatLocalRecap({
    stats: {
      sessionId: snapshot.sessionId,
      turnCount: snapshot.turnCount,
      tokens: snapshot.sessionTokens,
      compactions: snapshot.compactionCount,
    },
    workspaceDir: snapshot.workspaceDir ?? undefined,
    goalStatus: null,
    activeTasks: [],
    messages: snapshot.messages,
    limit,
  });
  return text.replace(
    "说明: 本回顾只读取当前本地会话状态，不调用模型、不联网、不写远端。",
    "说明: 本命令只读取本地已保存会话快照，不调用模型、不联网、不写远端。"
  );
}

export async function buildSavedSessionRecap(
  stateDir: string,
  request: SavedSessionRecapRequest
): Promise<string> {
  const registry = new SessionRegistry({ stateDir });
  const sessionRef = request.sessionRef || "latest";
  const snapshot = sessionRef === "latest"
    ? await registry.loadLatest()
    : await registry.load(sessionRef);

  if (!snapshot) {
    return formatMissingSavedSessionRecap(stateDir, sessionRef);
  }

  return formatSavedSessionRecap(snapshot, request.count);
}

export async function buildLocalRecap(context: SlashCommandContext, limit = 6): Promise<string> {
  const agentLoop = context.agentLoop as any;
  const stats = typeof agentLoop.getSessionStats === "function"
    ? await agentLoop.getSessionStats()
    : {
        sessionId: typeof agentLoop.getSessionId === "function" ? agentLoop.getSessionId() : "",
        turnCount: 0,
        tokens: 0,
        compactions: 0,
      };
  const messages = typeof agentLoop.getMessagesSnapshot === "function"
    ? await agentLoop.getMessagesSnapshot()
    : [];
  const tasks = context.scheduler && typeof (context.scheduler as any).listTasks === "function"
    ? await (context.scheduler as any).listTasks()
    : [];
  const activeTasks = Array.isArray(tasks)
    ? tasks.filter((task: any) => task.status !== "completed" && task.status !== "canceled")
    : [];
  const goalStatus = context.goalController && typeof (context.goalController as any).getGoalStatus === "function"
    ? await (context.goalController as any).getGoalStatus()
    : null;
  const workspaceDir = typeof agentLoop.getWorkspaceDir === "function"
    ? agentLoop.getWorkspaceDir()
    : context.workspaceDir;

  return formatLocalRecap({
    stats,
    workspaceDir,
    goalStatus,
    activeTasks,
    messages: Array.isArray(messages) ? messages : [],
    limit,
  });
}
