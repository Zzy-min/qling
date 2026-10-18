// ============================================================
// 强制规则文件加载：user-rules / AGENTS.md 等必须注入 system prompt
// ============================================================

import * as fs from "fs/promises";
import * as path from "path";
import os from "node:os";

const MAX_FILE_CHARS = 24_000;
const MAX_TOTAL_CHARS = 48_000;

export interface LoadedRuleFile {
  source: string;
  content: string;
}

/**
 * 候选路径（存在则加载；先写的优先级更高，用于去重后仍按序拼接）。
 */
export function ruleFileCandidates(options: {
  workspaceDir?: string | null;
  stateDir?: string;
  homeDir?: string;
}): string[] {
  const home = options.homeDir || os.homedir();
  const state = options.stateDir || path.join(home, ".qling");
  const ws = options.workspaceDir?.trim() || "";
  const list: string[] = [
    // 全局用户硬规则（记忆目录）
    path.join(state, "memory", "user-rules.md"),
    path.join(state, "memory", "user-name.md"),
    // 用户主目录宪法
    path.join(home, "Agents.md"),
    path.join(home, "AGENTS.md"),
    path.join(home, "Claude.md"),
    path.join(home, "CLAUDE.md"),
  ];
  if (ws) {
    list.push(
      path.join(ws, "AGENTS.md"),
      path.join(ws, "Agents.md"),
      path.join(ws, "CLAUDE.md"),
      path.join(ws, "Claude.md"),
      path.join(ws, ".qling", "rules.md")
    );
  }
  return list;
}

/** Test seam. Production uses node:fs/promises. Not read from the environment. */
export interface RuleFileReadOps {
  stat(filePath: string): Promise<{ isFile(): boolean }>;
  readFile(filePath: string, encoding: "utf8"): Promise<string>;
  realpath(filePath: string): Promise<string>;
}

const defaultRuleFileOps: RuleFileReadOps = {
  stat: (filePath) => fs.stat(filePath),
  readFile: (filePath, encoding) => fs.readFile(filePath, encoding),
  realpath: (filePath) => fs.realpath(filePath),
};

async function readIfExists(filePath: string, ops: RuleFileReadOps): Promise<LoadedRuleFile | null> {
  try {
    const st = await ops.stat(filePath);
    if (!st.isFile()) return null;
    let raw = await ops.readFile(filePath, "utf8");
    raw = raw.replace(/^\uFEFF/, "").trim();
    if (!raw) return null;
    if (raw.length > MAX_FILE_CHARS) {
      raw = raw.slice(0, MAX_FILE_CHARS) + "\n\n…[truncated]";
    }
    return { source: filePath, content: raw };
  } catch {
    return null;
  }
}

async function physicalRuleIdentity(filePath: string, ops: RuleFileReadOps): Promise<string> {
  try {
    return await ops.realpath(filePath);
  } catch {
    return filePath;
  }
}

/**
 * 加载并去重。缺失的大小写变体不能占掉另一个真实文件。
 * 同一物理文件（realpath，Windows/macOS 上 Agents.md 与 AGENTS.md 相同）只加载一次。
 * 内容相同的不同路径也只保留先出现的一份。
 */
export async function loadMandatoryRuleFiles(options: {
  workspaceDir?: string | null;
  stateDir?: string;
  homeDir?: string;
  fileSystem?: RuleFileReadOps;
}): Promise<LoadedRuleFile[]> {
  const ops = options.fileSystem ?? defaultRuleFileOps;
  const seenPhysical = new Set<string>();
  const seenContent = new Set<string>();
  const out: LoadedRuleFile[] = [];
  let total = 0;
  for (const p of ruleFileCandidates(options)) {
    const normalized = path.resolve(p);
    const file = await readIfExists(normalized, ops);
    if (!file) continue;
    const physical = await physicalRuleIdentity(normalized, ops);
    if (seenPhysical.has(physical)) continue;
    seenPhysical.add(physical);
    if (seenContent.has(file.content)) continue;
    seenContent.add(file.content);
    if (total + file.content.length > MAX_TOTAL_CHARS) {
      const room = MAX_TOTAL_CHARS - total;
      if (room < 200) break;
      out.push({
        source: file.source,
        content: file.content.slice(0, room) + "\n\n…[truncated total]",
      });
      break;
    }
    out.push(file);
    total += file.content.length;
  }
  return out;
}

/**
 * 拼装为 system prompt 强制约束块（高约束语气）。
 */
export function formatMandatoryRulesBlock(files: LoadedRuleFile[]): string {
  if (files.length === 0) {
    return [
      "【强制用户规则 / MANDATORY RULES】",
      "未发现 user-rules.md / AGENTS.md 等规则文件。",
      "仍须遵守：诚实优先；无新鲜验证证据不得声称完成/通过；危险操作先确认。",
    ].join("\n");
  }
  const body = files
    .map((f, i) => {
      const label = path.basename(f.source);
      return `### 规则源 ${i + 1}: ${label}\n路径: ${f.source}\n\n${f.content}`;
    })
    .join("\n\n---\n\n");
  return [
    "【强制用户规则 / MANDATORY RULES — 最高优先级】",
    "以下规则为**硬约束**，优先级高于默认工具习惯、示例与你的即兴策略。",
    "违反任一条即视为任务失败；不得用「更方便」「先做了再说」绕过。",
    "若用户本轮指令与硬规则冲突：先指出冲突，再请求确认，不得默默违反硬规则。",
    "完成、修复、通过、已验证等结论必须先有本轮新鲜可核对证据。",
    "",
    body,
  ].join("\n");
}
