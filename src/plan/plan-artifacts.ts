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

/** 把任意风格路径规范到当前平台分隔符，避免 Windows 路径串在 Linux 上失真 */
function coercePathInput(input: string): string {
  return String(input || "").replace(/\\/g, path.sep);
}

/**
 * 是否为 Plan Mode 允许写入的产物路径。
 * 支持绝对路径与相对 workspace 路径；路径分隔符跨平台可混用。
 */
export function isPlanArtifactPath(
  filePath: string,
  workspaceDir: string
): boolean {
  if (!filePath || typeof filePath !== "string") return false;
  const root = path.resolve(coercePathInput(workspaceDir || process.cwd()));
  const candidate = coercePathInput(filePath);
  const abs = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(root, candidate);
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

/**
 * Plan Mode 系统附加约束（与 Hook 权限双保险）。
 * 目标：模型必须先写计划文件，禁止在 plan 内直接实施/改业务代码。
 */
export function buildPlanModeSystemAddon(): string {
  return `【Plan Mode — 强制规划，禁止直接执行】

你当前处于 **Plan Mode（只读规划）**，不是 Agent 实施模式。

## 必须做
1. **只产出计划**：阅读/搜索代码与资料，形成可执行方案。
2. **必须落盘计划文件**：用 write 写入以下之一（相对工作区）：
   - \`.qling/plans/<时间戳-标题>.md\`
   - \`docs/superpowers/plans/<时间戳-标题>.md\`
3. 计划内容至少包含：目标与边界、推荐方案、关键文件路径、步骤拆解、验证方式、风险。
4. 写完计划后 **停止**，用简短中文告知用户：计划路径 +「请用 /plan approve 审批后实施」。
5. 若信息不足：先用 read/search 补齐，再写计划；仍不足则在计划中列出待确认问题。

## 禁止做
1. **禁止直接实施**：不得改业务代码、不得跑构建/测试/安装、不得 bash/subtask/browser。
2. **禁止口头计划代替落盘**：最终交付物必须是计划目录下的 .md 文件。
3. **禁止「先改一点试试」**：任何业务写操作会被拒绝；被拒绝后应回头写计划，而不是反复尝试执行类工具。
4. write/patch **只能**写计划目录；写其它路径会被拒绝。

## 权限内可用工具
- 允许：read、search、todo、code_symbols、lsp、write/patch（仅计划目录）、skill（只读知识）
- 禁止：bash、subtask、browser_fetch、browser_act、bg_kill、业务目录的 write/patch

## 退出
- 用户执行 \`/plan approve\` 后才会退出 Plan Mode 并进入实施。
- 在此之前你的唯一交付是：**计划文件 + 简要说明**。`;
}

export function buildImplementPromptFromPlan(planPath: string, planBody: string): string {
  const excerpt = planBody.replace(/\s+/g, " ").trim().slice(0, 800);
  return `Implement plan (${planPath}). Small verified steps.\n${excerpt}`;
}
