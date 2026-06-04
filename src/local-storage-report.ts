import { lstat, readdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { SlashCommandContext } from "./commands/runtime.js";
import { resolveSessionExportsDir } from "./session-export.js";

const DEFAULT_SCAN_LIMIT = 5000;

export type LocalStorageBucketId = "state" | "sessions" | "exports" | "cache";

export interface LocalStorageBucket {
  id: LocalStorageBucketId;
  label: string;
  path: string;
  exists: boolean;
  fileCount: number;
  dirCount: number;
  otherCount: number;
  sizeBytes: number;
  scannedEntries: number;
  truncated: boolean;
  error: string | null;
}

export interface LocalStorageReport {
  workspaceDir: string;
  stateDir: string;
  sessionsDir: string;
  exportsDir: string;
  cacheDir: string;
  scanLimit: number;
  buckets: LocalStorageBucket[];
}

export interface LocalStorageReportOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  maxEntries?: number;
}

function resolveStateDir(
  context: SlashCommandContext,
  env: LocalStorageReportOptions["env"]
): string {
  const agentLoop = context.agentLoop as any;
  return env?.QLING_FILE_STATE_DIR
    || agentLoop.getRuntimeRootDir?.()
    || join(homedir(), ".qling");
}

function resolveCacheDir(env: LocalStorageReportOptions["env"], stateDir: string): string {
  return env?.QLING_FILE_CACHE_DIR || join(stateDir, "cache");
}

function resolveScanLimit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_SCAN_LIMIT;
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatBytes(bytes: number): string {
  const safeBytes = Math.max(0, Number(bytes) || 0);
  if (safeBytes < 1024) return `${safeBytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = safeBytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

async function scanBucket(id: LocalStorageBucketId, label: string, path: string, scanLimit: number): Promise<LocalStorageBucket> {
  const bucket: LocalStorageBucket = {
    id,
    label,
    path,
    exists: true,
    fileCount: 0,
    dirCount: 0,
    otherCount: 0,
    sizeBytes: 0,
    scannedEntries: 0,
    truncated: false,
    error: null,
  };

  async function walk(targetPath: string): Promise<void> {
    if (bucket.scannedEntries >= scanLimit) {
      bucket.truncated = true;
      return;
    }

    let entry;
    try {
      entry = await lstat(targetPath);
    } catch (error) {
      if (isNotFoundError(error) && targetPath === path) {
        bucket.exists = false;
        return;
      }
      bucket.error = errorToString(error);
      return;
    }

    bucket.scannedEntries += 1;
    if (entry.isDirectory()) {
      bucket.dirCount += 1;
      let children: string[];
      try {
        children = await readdir(targetPath);
      } catch (error) {
        bucket.error = errorToString(error);
        return;
      }
      for (const child of children) {
        if (bucket.scannedEntries >= scanLimit) {
          bucket.truncated = true;
          break;
        }
        await walk(join(targetPath, child));
      }
      return;
    }

    if (entry.isFile()) {
      bucket.fileCount += 1;
      bucket.sizeBytes += entry.size;
      return;
    }

    bucket.otherCount += 1;
    bucket.sizeBytes += entry.size;
  }

  await walk(path);
  if (!bucket.exists) {
    bucket.fileCount = 0;
    bucket.dirCount = 0;
    bucket.otherCount = 0;
    bucket.sizeBytes = 0;
    bucket.scannedEntries = 0;
    bucket.truncated = false;
    bucket.error = null;
  }
  return bucket;
}

export async function buildLocalStorageReport(
  context: SlashCommandContext,
  options: LocalStorageReportOptions = {}
): Promise<LocalStorageReport> {
  const env = options.env ?? process.env;
  const stateDir = resolveStateDir(context, env);
  const sessionsDir = join(stateDir, "sessions");
  const exportsDir = resolveSessionExportsDir(context, env);
  const cacheDir = resolveCacheDir(env, stateDir);
  const scanLimit = resolveScanLimit(options.maxEntries);
  const agentLoop = context.agentLoop as any;
  const workspaceDir = context.workspaceDir || agentLoop.getWorkspaceDir?.() || process.cwd();

  const bucketDefs: Array<[LocalStorageBucketId, string, string]> = [
    ["state", "State dir", stateDir],
    ["sessions", "Sessions", sessionsDir],
    ["exports", "Exports", exportsDir],
    ["cache", "Cache", cacheDir],
  ];

  const buckets = [];
  for (const [id, label, path] of bucketDefs) {
    buckets.push(await scanBucket(id, label, path, scanLimit));
  }

  return {
    workspaceDir,
    stateDir,
    sessionsDir,
    exportsDir,
    cacheDir,
    scanLimit,
    buckets,
  };
}

function bucketStatus(bucket: LocalStorageBucket): string {
  if (!bucket.exists) return "missing";
  if (bucket.error) return `warn (${bucket.error})`;
  if (bucket.truncated) return "truncated";
  return "ok";
}

export function formatLocalStorageReport(report: LocalStorageReport): string[] {
  const lines = [
    "",
    "💾 本地存储盘点",
    "-----------------------------------------",
    `Workspace : ${report.workspaceDir}`,
    `Scan cap  : ${report.scanLimit} entries per bucket`,
    "",
  ];

  for (const bucket of report.buckets) {
    lines.push(`${bucket.label}`);
    lines.push(`  Status    : ${bucketStatus(bucket)}`);
    lines.push(`  Files     : ${bucket.fileCount}`);
    lines.push(`  Dirs      : ${bucket.dirCount}`);
    lines.push(`  Other     : ${bucket.otherCount}`);
    lines.push(`  Size      : ${formatBytes(bucket.sizeBytes)}`);
    lines.push(`  Path      : ${bucket.path}`);
  }

  lines.push("-----------------------------------------");
  lines.push("说明      : 只读取本地文件元数据，不读取文件正文、不调用模型、不联网。");
  lines.push("提示      : 用 /privacy 看数据边界，用 /exports 查看 Markdown 导出。");
  lines.push("");
  return lines;
}
