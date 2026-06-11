import { join } from "path";
import { SessionRegistry, type SavedSessionSnapshot } from "./session/session-registry.js";

export interface LocalSessionCheckpointRequest {
  name?: string;
  sessionRef?: string;
  force?: boolean;
}

export interface LocalSessionCheckpointResult {
  stateDir: string;
  sessionsDir: string;
  sourceName: string;
  sourceSessionId: string;
  checkpointName: string;
  checkpointPath: string;
  updatedAt: string;
  turnCount: number;
  messageCount: number;
  sessionTokens: number;
  compactionCount: number;
}

export function parseLocalSessionCheckpointArgs(args: string[]): LocalSessionCheckpointRequest {
  const nameParts: string[] = [];
  let sessionRef: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force" || arg === "-f") {
      continue;
    }
    if (arg === "--session" || arg === "-s") {
      sessionRef = args[i + 1];
      i++;
      continue;
    }
    if (arg.startsWith("--session=")) {
      sessionRef = arg.slice("--session=".length).trim() || undefined;
      continue;
    }
    nameParts.push(arg);
  }

  return {
    name: nameParts.join(" ").trim() || undefined,
    sessionRef,
    force: args.includes("--force") || args.includes("-f"),
  };
}

export async function createLocalSessionCheckpoint(
  stateDir: string,
  request: LocalSessionCheckpointRequest = {},
  now = new Date()
): Promise<LocalSessionCheckpointResult> {
  const registry = new SessionRegistry({ stateDir });
  const source = request.sessionRef
    ? await registry.load(request.sessionRef)
    : await registry.loadLatest();

  if (!source) {
    const suffix = request.sessionRef ? `: ${request.sessionRef}` : "";
    throw new Error(`未找到可保存的本地会话快照${suffix}`);
  }

  const checkpointName = request.name?.trim() || defaultCheckpointName(now);
  if (request.name?.trim() && !request.force) {
    const existing = await registry.load(checkpointName);
    if (existing) {
      throw new Error(`本地检查点已存在: ${checkpointName}。如需覆盖，请显式添加 --force。`);
    }
  }

  const updatedAt = now.toISOString();
  const checkpointPath = await registry.save(copySnapshot(source, checkpointName, updatedAt));

  return {
    stateDir,
    sessionsDir: join(stateDir, "sessions"),
    sourceName: source.name,
    sourceSessionId: source.sessionId,
    checkpointName,
    checkpointPath,
    updatedAt,
    turnCount: source.turnCount,
    messageCount: source.messages.length,
    sessionTokens: source.sessionTokens,
    compactionCount: source.compactionCount,
  };
}

export function formatLocalSessionCheckpointResult(result: LocalSessionCheckpointResult): string[] {
  return [
    "",
    "💾 本地会话检查点",
    "-----------------------------------------",
    `State dir : ${result.stateDir}`,
    `Sessions  : ${result.sessionsDir}`,
    `Source    : ${result.sourceName} | ${result.sourceSessionId}`,
    `Checkpoint: ${result.checkpointName}`,
    `Path      : ${result.checkpointPath}`,
    `Updated   : ${formatTime(result.updatedAt)}`,
    `Turns     : ${result.turnCount}`,
    `Messages  : ${result.messageCount}`,
    `Tokens    : ${result.sessionTokens.toLocaleString()}`,
    `Compacts  : ${result.compactionCount}`,
    "-----------------------------------------",
    "说明      : 只复制本地会话快照；不输出消息正文、不调用模型、不联网。",
    "",
  ];
}

function copySnapshot(
  source: SavedSessionSnapshot,
  name: string,
  updatedAt: string
): Omit<SavedSessionSnapshot, "version"> {
  return {
    name,
    sessionId: source.sessionId,
    workspaceDir: source.workspaceDir,
    createdAt: source.createdAt,
    updatedAt,
    messages: source.messages.map((message) => ({ ...message })),
    turnCount: source.turnCount,
    sessionTokens: source.sessionTokens,
    compactionCount: source.compactionCount,
  };
}

function defaultCheckpointName(now: Date): string {
  return `checkpoint-${now.toISOString().replace(/[:.]/g, "-")}`;
}

function formatTime(value: string): string {
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? value : new Date(ts).toLocaleString();
}
