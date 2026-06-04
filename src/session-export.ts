import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { join, resolve } from "path";
import type { SlashCommandContext } from "./commands/runtime.js";

interface ExportMessage {
  role?: string;
  content?: unknown;
}

export interface SessionExportSnapshot {
  sessionId: string;
  workspaceDir: string;
  exportedAt: string;
  turnCount: number;
  tokens: number;
  compactions: number;
  messages: ExportMessage[];
}

export interface SessionExportOptions {
  now?: () => Date;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export interface SessionExportResult {
  path: string;
  messageCount: number;
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function sanitizeFilePart(value: string): string {
  return (value || "session")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "session";
}

function timestampForFile(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function resolveStateDir(context: SlashCommandContext, env: SessionExportOptions["env"]): string {
  const agentLoop = context.agentLoop as any;
  return env?.QINGLING_FILE_STATE_DIR
    || agentLoop.getRuntimeRootDir?.()
    || join(homedir(), ".qingling");
}

export function resolveSessionExportsDir(
  context: SlashCommandContext,
  env: SessionExportOptions["env"] = process.env
): string {
  return resolve(resolveStateDir(context, env), "exports");
}

export function formatSessionExportMarkdown(snapshot: SessionExportSnapshot): string {
  const lines = [
    "# qling Session Export",
    "",
    `- session: ${snapshot.sessionId || "-"}`,
    `- workspace: ${snapshot.workspaceDir || "-"}`,
    `- exportedAt: ${snapshot.exportedAt}`,
    `- turns: ${Number(snapshot.turnCount ?? 0)}`,
    `- tokens: ${Number(snapshot.tokens ?? 0).toLocaleString()}`,
    `- compactions: ${Number(snapshot.compactions ?? 0)}`,
    "",
    "> This file was exported locally by qling. No model call or network request is required for export.",
    "",
    "# Messages",
    "",
  ];

  if (!snapshot.messages.length) {
    lines.push("_No messages in current session._");
    lines.push("");
    return lines.join("\n");
  }

  snapshot.messages.forEach((message, index) => {
    const role = String(message.role || "unknown");
    lines.push(`## ${role} ${index + 1}`);
    lines.push("");
    lines.push("```text");
    lines.push(stringifyContent(message.content ?? ""));
    lines.push("```");
    lines.push("");
  });

  return lines.join("\n");
}

export async function buildSessionExportSnapshot(
  context: SlashCommandContext,
  options: SessionExportOptions = {}
): Promise<SessionExportSnapshot> {
  const agentLoop = context.agentLoop as any;
  const stats = typeof agentLoop.getSessionStats === "function"
    ? await agentLoop.getSessionStats()
    : {
        sessionId: agentLoop.getSessionId?.() ?? "session",
        turnCount: 0,
        tokens: 0,
        compactions: 0,
      };
  const messages = typeof agentLoop.getMessagesSnapshot === "function"
    ? await agentLoop.getMessagesSnapshot()
    : [];
  const now = options.now?.() ?? new Date();

  return {
    sessionId: stats.sessionId || agentLoop.getSessionId?.() || "session",
    workspaceDir: context.workspaceDir || agentLoop.getWorkspaceDir?.() || process.cwd(),
    exportedAt: now.toISOString(),
    turnCount: Number(stats.turnCount ?? 0),
    tokens: Number(stats.tokens ?? 0),
    compactions: Number(stats.compactions ?? stats.compactionCount ?? 0),
    messages: Array.isArray(messages) ? messages : [],
  };
}

export async function writeSessionExport(
  context: SlashCommandContext,
  options: SessionExportOptions = {}
): Promise<SessionExportResult> {
  const snapshot = await buildSessionExportSnapshot(context, options);
  const exportsDir = resolveSessionExportsDir(context, options.env ?? process.env);
  await mkdir(exportsDir, { recursive: true });

  const fileName = `${sanitizeFilePart(snapshot.sessionId)}-${timestampForFile(new Date(snapshot.exportedAt))}.md`;
  const targetPath = join(exportsDir, fileName);
  await writeFile(targetPath, formatSessionExportMarkdown(snapshot), { encoding: "utf8", flag: "wx" });

  return {
    path: targetPath,
    messageCount: snapshot.messages.length,
  };
}
