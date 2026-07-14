import { readdir, stat } from "fs/promises";
import { join } from "path";
import type { SlashCommandContext } from "./slash-context.js";
import { resolveSessionExportsDir } from "./session-export.js";

const DEFAULT_EXPORT_COUNT = 10;
const MAX_EXPORT_COUNT = 50;

export interface SessionExportIndexEntry {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  modifiedAtMs: number;
}

export interface SessionExportIndexReport {
  exportsDir: string;
  entries: SessionExportIndexEntry[];
  total: number;
  requestedCount: number;
  truncated: boolean;
}

export interface SessionExportIndexOptions {
  count?: number;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export function parseSessionExportCount(value?: string | number): number {
  if (value === undefined || value === null || value === "") return DEFAULT_EXPORT_COUNT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EXPORT_COUNT;
  return Math.min(Math.floor(parsed), MAX_EXPORT_COUNT);
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export async function listSessionExportFiles(
  context: SlashCommandContext,
  options: SessionExportIndexOptions = {}
): Promise<SessionExportIndexReport> {
  const requestedCount = parseSessionExportCount(options.count);
  const exportsDir = resolveSessionExportsDir(context, options.env ?? process.env);

  let names: string[];
  try {
    names = await readdir(exportsDir);
  } catch (error) {
    if (isNotFoundError(error)) {
      return { exportsDir, entries: [], total: 0, requestedCount, truncated: false };
    }
    throw error;
  }

  const entries: SessionExportIndexEntry[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    const path = join(exportsDir, name);
    const fileStat = await stat(path);
    if (!fileStat.isFile()) continue;
    entries.push({
      name,
      path,
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      modifiedAtMs: fileStat.mtimeMs,
    });
  }

  entries.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs || left.name.localeCompare(right.name));

  return {
    exportsDir,
    entries: entries.slice(0, requestedCount),
    total: entries.length,
    requestedCount,
    truncated: entries.length > requestedCount,
  };
}

export function formatSessionExportIndex(report: SessionExportIndexReport): string[] {
  const lines = [
    "",
    "📚 本地导出列表",
    "-----------------------------------------",
    `Dir       : ${report.exportsDir}`,
    `Count     : ${report.entries.length}/${report.total}`,
  ];

  if (!report.entries.length) {
    lines.push("Status    : 还没有导出；使用 /export 生成本地 Markdown。");
    lines.push("-----------------------------------------");
    lines.push("");
    return lines;
  }

  if (report.truncated) {
    lines.push(`Limit     : 显示最近 ${report.requestedCount} 条`);
  }
  lines.push("");

  report.entries.forEach((entry, index) => {
    lines.push(`${index + 1}.`);
    lines.push(`   文件名   : ${entry.name}`);
    lines.push(`   修改时间 : ${entry.modifiedAt}`);
    lines.push(`   大小     : ${formatBytes(entry.sizeBytes)}`);
    lines.push(`   绝对路径 : ${entry.path}`);
  });

  lines.push("-----------------------------------------");
  lines.push("说明      : 仅读取本地文件元数据，不读取导出正文、不调用模型、不联网。");
  lines.push("");
  return lines;
}
