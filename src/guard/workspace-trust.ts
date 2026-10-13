// Workspace trust gate. Project skills, project agents, and any future
// project hook source stay unloaded until the workspace is trusted.
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TRUST_FILE_NAME = "trusted-workspaces";

export interface WorkspaceTrustOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  trustFilePath?: string;
}

export function resolveQlingHome(
  env: NodeJS.ProcessEnv = process.env,
  fallbackHome: string = os.homedir()
): string {
  const raw = String(env.QLING_HOME ?? "").trim();
  return raw ? path.resolve(raw) : fallbackHome;
}

export function trustedWorkspacesFile(options: WorkspaceTrustOptions = {}): string {
  if (options.trustFilePath?.trim()) return path.resolve(options.trustFilePath);
  const env = options.env ?? process.env;
  const override = String(env.QLING_TRUSTED_WORKSPACES_FILE ?? "").trim();
  // A pinned homeDir (tests, role loader) owns the trust file. The env path
  // applies only when the caller did not choose a home.
  if (override && options.homeDir === undefined) return path.resolve(override);
  const home = options.homeDir ?? resolveQlingHome(env);
  return path.join(home, ".qling", TRUST_FILE_NAME);
}

/** Absolute path, trailing separator removed except for the drive/root. */
export function normalizeTrustPath(input: string): string {
  const resolved = path.resolve(String(input ?? "").trim());
  const root = path.parse(resolved).root;
  let trimmed = resolved;
  while (
    trimmed.length > root.length &&
    (trimmed.endsWith("/") || trimmed.endsWith("\\"))
  ) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

export function trustPathKey(input: string): string {
  const normalized = normalizeTrustPath(input);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Child directories inherit trust. A shared string prefix is not enough:
 * C:\a must not trust C:\ab.
 */
export function isPathInsideTrustedRoot(trustedRoot: string, dir: string): boolean {
  const rootKey = trustPathKey(trustedRoot);
  const dirKey = trustPathKey(dir);
  if (rootKey === dirKey) return true;
  const prefix = rootKey.endsWith(path.sep) ? rootKey : rootKey + path.sep;
  return dirKey.startsWith(prefix);
}

export function parseTrustedWorkspaceFile(text: string): string[] {
  const entries: string[] = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    entries.push(normalizeTrustPath(trimmed));
  }
  return entries;
}

export function isTrustAllWorkspaces(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(String(env.QLING_TRUST_ALL_WORKSPACES ?? "").trim());
}

function readEntriesSync(filePath: string): string[] {
  try {
    return parseTrustedWorkspaceFile(readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }
}

export function isWorkspaceTrusted(dir: string, options: WorkspaceTrustOptions = {}): boolean {
  const env = options.env ?? process.env;
  if (isTrustAllWorkspaces(env)) return true;
  const entries = readEntriesSync(trustedWorkspacesFile({ ...options, env }));
  return entries.some((entry) => isPathInsideTrustedRoot(entry, dir));
}

async function readEntries(filePath: string): Promise<{ entries: string[]; comments: string[] }> {
  try {
    const raw = await readFile(filePath, "utf8");
    const comments = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("#"));
    return { entries: parseTrustedWorkspaceFile(raw), comments };
  } catch {
    return { entries: [], comments: [] };
  }
}

async function writeEntries(filePath: string, entries: string[], comments: string[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const header = comments.length > 0
    ? comments
    : [
        "# qling trusted workspaces",
        "# one normalized absolute path per line; lines starting with # are comments",
        "# child directories inherit; a shared prefix is not trust (C:\\a does not trust C:\\ab)",
      ];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = trustPathKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(normalizeTrustPath(entry));
  }
  await writeFile(filePath, [...header, ...unique, ""].join("\n"), "utf8");
}

export async function listTrustedWorkspaces(options: WorkspaceTrustOptions = {}): Promise<string[]> {
  const filePath = trustedWorkspacesFile(options);
  return (await readEntries(filePath)).entries;
}

export async function trustWorkspace(dir: string, options: WorkspaceTrustOptions = {}): Promise<string> {
  const filePath = trustedWorkspacesFile(options);
  const normalized = normalizeTrustPath(dir);
  const current = await readEntries(filePath);
  const key = trustPathKey(normalized);
  if (!current.entries.some((entry) => trustPathKey(entry) === key)) {
    current.entries.push(normalized);
    await writeEntries(filePath, current.entries, current.comments);
  }
  return normalized;
}

/** Removes an exact trusted entry. Trust inherited from a parent is left intact. */
export async function untrustWorkspace(dir: string, options: WorkspaceTrustOptions = {}): Promise<boolean> {
  const filePath = trustedWorkspacesFile(options);
  const key = trustPathKey(dir);
  const current = await readEntries(filePath);
  const next = current.entries.filter((entry) => trustPathKey(entry) !== key);
  const removed = next.length !== current.entries.length;
  if (removed) await writeEntries(filePath, next, current.comments);
  return removed;
}

const hintedWorkspaces = new Set<string>();

export function formatUntrustedWorkspaceHint(dir: string): string {
  const shown = normalizeTrustPath(dir);
  return [
    `当前工作区未受信，项目级技能与项目级代理未加载：${shown}`,
    "标记受信：qling trust [dir]",
    "或把规范化绝对路径写入 ~/.qling/trusted-workspaces（# 为注释；子目录继承父目录；Windows 不区分大小写）。",
    "预信任全部工作区：环境变量 QLING_TRUST_ALL_WORKSPACES=true（默认 false）。项目目录里的 qling.config 不能打开该开关。",
  ].join("\n");
}

/** One hint per process per workspace. Null when trusted or already emitted. */
export function claimUntrustedWorkspaceHint(
  dir: string,
  options: WorkspaceTrustOptions = {}
): string | null {
  if (isWorkspaceTrusted(dir, options)) return null;
  const key = trustPathKey(dir);
  if (hintedWorkspaces.has(key)) return null;
  hintedWorkspaces.add(key);
  return formatUntrustedWorkspaceHint(dir);
}

export function resetWorkspaceTrustHintsForTests(): void {
  hintedWorkspaces.clear();
}
