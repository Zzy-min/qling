// ============================================================
// Phase 3.2 — 子代理角色与工具白名单
// explore / implement / review
// ============================================================

import type { ToolDefinition } from "../types.js";

export type SubAgentRole = "explore" | "implement" | "review";

export const SUBAGENT_ROLES: SubAgentRole[] = ["explore", "implement", "review"];

export interface RoleDefinition {
  id: SubAgentRole;
  title: string;
  description: string;
  /** 允许的工具名；不含 subtask（禁止嵌套） */
  allowedTools: string[];
  /** 写入类工具是否允许 */
  canWrite: boolean;
}

/** 角色工具白名单（与 ALL_TOOLS 对齐的子集） */
export const ROLE_DEFINITIONS: Record<SubAgentRole, RoleDefinition> = {
  explore: {
    id: "explore",
    title: "探索",
    description: "只读探索代码库：search/read/skill/planner/url_fetch，禁止写与 bash。",
    allowedTools: [
      "read",
      "search",
      "code_symbols",
      "lsp",
      "skill",
      "planner",
      "url_fetch",
    ],
    canWrite: false,
  },
  implement: {
    id: "implement",
    title: "实现",
    description: "实现改动：read/search/write/patch/bash/skill/todo，禁止再 spawn subtask。",
    allowedTools: [
      "read",
      "search",
      "code_symbols",
      "lsp",
      "write",
      "patch",
      "bash",
      "skill",
      "todo",
      "planner",
      "url_fetch",
    ],
    canWrite: true,
  },
  review: {
    id: "review",
    title: "审查",
    description: "只读审查：read/search/skill，产出 CRITICAL/HIGH 清单，禁止写与 bash。",
    allowedTools: ["read", "search", "code_symbols", "lsp", "skill", "planner"],
    canWrite: false,
  },
};

export function normalizeSubAgentRole(raw: unknown): SubAgentRole {
  const s = String(raw ?? "implement").trim().toLowerCase();
  if (s === "explore" || s === "探索" || s === "read" || s === "readonly") return "explore";
  if (s === "review" || s === "审查" || s === "audit") return "review";
  if (s === "implement" || s === "实现" || s === "build" || s === "code") return "implement";
  // 未知角色降级为 implement（可写完整能力），但调用方可校验
  if ((SUBAGENT_ROLES as string[]).includes(s)) return s as SubAgentRole;
  return "implement";
}

export function isKnownSubAgentRole(raw: unknown): boolean {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return true; // 缺省合法
  return (
    s === "explore" ||
    s === "implement" ||
    s === "review" ||
    s === "探索" ||
    s === "实现" ||
    s === "审查" ||
    s === "read" ||
    s === "readonly" ||
    s === "build" ||
    s === "code" ||
    s === "audit"
  );
}

export function getRoleDefinition(role: SubAgentRole): RoleDefinition {
  return ROLE_DEFINITIONS[role];
}

/**
 * 按角色过滤工具；始终剔除 subtask，防止嵌套。
 */
export function filterToolsForRole(
  tools: ToolDefinition[] | undefined,
  role: SubAgentRole
): ToolDefinition[] {
  const def = ROLE_DEFINITIONS[role];
  const allow = new Set(def.allowedTools);
  return (tools ?? []).filter((t) => t.name !== "subtask" && allow.has(t.name));
}

export interface SubAgentReturnContract {
  role: SubAgentRole;
  success: boolean;
  durationMs: number;
  iterations: number;
  summary: string;
  filesTouched: string[];
  evidence: string[];
  /** 原始模型输出（已截断） */
  rawOutput: string;
  usage?: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    costUsd?: string;
    costIsPartial: boolean;
    usageIsIncomplete: boolean;
  };
}

const RAW_OUTPUT_MAX = 4000;

/**
 * 父代理只应消费此契约文本，避免整段子会话上浮。
 */
export function formatSubAgentReturnContract(c: SubAgentReturnContract): string {
  const files =
    c.filesTouched.length > 0
      ? c.filesTouched.map((f) => `  - ${f}`).join("\n")
      : "  (无)";
  const evidence =
    c.evidence.length > 0
      ? c.evidence.map((e) => `  - ${e}`).join("\n")
      : "  (无)";
  let raw = c.rawOutput.trim();
  if (raw.length > RAW_OUTPUT_MAX) {
    raw =
      raw.slice(0, 2000) +
      `\n…[子代理输出已截断 ${raw.length}→${RAW_OUTPUT_MAX}]…\n` +
      raw.slice(-1200);
  }

  return [
    "【子代理回传契约】",
    `role: ${c.role}`,
    `success: ${c.success}`,
    `duration_ms: ${c.durationMs}`,
    `iterations_budget: ${c.iterations}`,
    ...(c.usage
      ? [
          `usage_tokens: ${c.usage.totalTokens} (in=${c.usage.promptTokens}, out=${c.usage.completionTokens})`,
          `usage_complete: ${!c.usage.usageIsIncomplete}`,
          `cost: ${c.usage.costUsd ? `$${c.usage.costUsd}` : c.usage.costIsPartial ? "partial/omitted" : "$0"}`,
        ]
      : []),
    `summary: ${c.summary || "(空)"}`,
    "files_touched:",
    files,
    "evidence:",
    evidence,
    "output:",
    raw || "(空)",
  ].join("\n");
}

/**
 * 从消息历史提取 write/patch 目标路径。
 */
export function extractFilesTouchedFromMessages(
  messages: Array<{
    role?: string;
    content?: string;
    tool_calls?: Array<{
      function?: { name?: string; arguments?: string };
    }>;
  }>
): string[] {
  const files = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        const name = tc.function?.name ?? "";
        if (name !== "write" && name !== "patch") continue;
        try {
          const args =
            typeof tc.function?.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : tc.function?.arguments;
          const p = String(args?.path ?? args?.file ?? "").trim();
          if (p) files.add(p);
        } catch {
          // ignore
        }
      }
    }
  }
  return Array.from(files).sort();
}

/**
 * 从输出中抽简短 evidence 行（失败信息 / 测试命令）。
 */
export function extractEvidenceHints(output: string, max = 5): string[] {
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  const hints: string[] = [];
  for (const line of lines) {
    if (
      /error|fail|拒绝|失败|PASS|FAIL|✓|✗|assert|exception/i.test(line) ||
      /npm |node |pytest |cargo |go test/i.test(line)
    ) {
      hints.push(line.slice(0, 160));
      if (hints.length >= max) break;
    }
  }
  return hints;
}

export function buildRoleSystemPreamble(role: SubAgentRole): string {
  const def = ROLE_DEFINITIONS[role];
  const tools = def.allowedTools.join(", ");
  if (role === "explore") {
    return (
      `【子代理角色: explore / 探索】\n` +
      `你只做只读探索与总结。可用工具: ${tools}。\n` +
      `禁止修改文件、禁止 bash。最终回复用中文给出：发现、关键路径、建议下一步。`
    );
  }
  if (role === "review") {
    return (
      `【子代理角色: review / 审查】\n` +
      `你只做只读代码审查。可用工具: ${tools}。\n` +
      `禁止修改文件、禁止 bash。最终按 CRITICAL/HIGH/MEDIUM/LOW 列表输出，并引用文件路径。`
    );
  }
  return (
    `【子代理角色: implement / 实现】\n` +
    `你负责实现指定子任务。可用工具: ${tools}。\n` +
    `禁止再调用 subtask。完成后用中文总结改动与验证方式。`
  );
}

/** 供 /agents 展示的静态角色说明 */
export function formatRolesHelp(): string {
  const lines = ["🎭 【子代理角色】subtask role=…", ""];
  for (const id of SUBAGENT_ROLES) {
    const d = ROLE_DEFINITIONS[id];
    lines.push(`- ${d.id}（${d.title}）`);
    lines.push(`  ${d.description}`);
    lines.push(`  工具: ${d.allowedTools.join(", ")}`);
    lines.push(`  可写: ${d.canWrite ? "是" : "否"}`);
  }
  lines.push("");
  lines.push("示例: subtask task=\"定位登录 bug\" role=explore");
  lines.push(
    "并行(默认关): QLING_SUBTASK_PARALLEL=1 后 subtask tasks=[\"A\",\"B\"] role=explore"
  );
  lines.push("回传: 父上下文只收【子代理回传契约】，不含完整子会话。");
  return lines.join("\n");
}
