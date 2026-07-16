// ============================================================
// Plan Mode 产物路径：允许只写计划文件，其余写操作仍拒绝
// ============================================================

import { existsSync } from "fs";
import { mkdir, readdir, readFile, stat } from "fs/promises";
import * as path from "path";

/** 相对工作区的计划目录（优先顺序） */
export const PLAN_DIR_RELS = [
  path.join(".qling", "plans"),
  path.join("docs", "superpowers", "plans"),
] as const;

export function resolvePlanRoots(workspaceDir: string): string[] {
  const root = path.resolve(workspaceDir || process.cwd());
  return PLAN_DIR_RELS.map((rel) => path.resolve(root, rel));
}

/**
 * 是否为 Plan Mode 允许写入的产物路径。
 * 支持绝对路径与相对 workspace 路径。
 */
export function isPlanArtifactPath(
  filePath: string,
  workspaceDir: string
): boolean {
  if (!filePath || typeof filePath !== "string") return false;
  const root = path.resolve(workspaceDir || process.cwd());
  const abs = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath);
  const roots = resolvePlanRoots(root);
  return roots.some((planRoot) => {
    const rel = path.relative(planRoot, abs);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

/** 从 write/patch 参数中取出目标路径 */
export function extractWriteTargetPath(args: Record<string, unknown> | undefined): string {
  if (!args || typeof args !== "object") return "";
  const candidates = [args.path, args.file, args.filepath, args.target];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

export function defaultPlanFileName(title?: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = (title || "plan")
    .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${stamp}-${slug || "plan"}.md`;
}

export async function ensureDefaultPlanDir(workspaceDir: string): Promise<string> {
  const dir = resolvePlanRoots(workspaceDir)[0]!;
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function listPlanFiles(
  workspaceDir: string,
  limit = 20
): Promise<Array<{ path: string; name: string; updatedAt: string; size: number }>> {
  const roots = resolvePlanRoots(workspaceDir);
  const found: Array<{ path: string; name: string; updatedAt: string; size: number }> = [];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries: string[] = [];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".md")) continue;
      const full = path.join(root, name);
      try {
        const st = await stat(full);
        if (!st.isFile()) continue;
        found.push({
          path: full,
          name,
          updatedAt: st.mtime.toISOString(),
          size: st.size,
        });
      } catch {
        // skip
      }
    }
  }

  return found
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, Math.max(1, limit));
}

export async function readLatestPlanFile(
  workspaceDir: string
): Promise<{ path: string; content: string } | null> {
  const list = await listPlanFiles(workspaceDir, 1);
  if (list.length === 0) return null;
  const top = list[0]!;
  const content = await readFile(top.path, "utf-8");
  return { path: top.path, content };
}

/** 注入 system 的短约束（权限仍由 Hook 强制；此处不灌长文案） */
export function buildPlanModeSystemAddon(): string {
  return "Plan mode: no bash/subtask/browser; write/patch only under .qling/plans/ or docs/superpowers/plans/.";
}

export function buildImplementPromptFromPlan(planPath: string, planBody: string): string {
  const excerpt = planBody.replace(/\s+/g, " ").trim().slice(0, 800);
  return `Implement plan (${planPath}). Small verified steps.\n${excerpt}`;
}
