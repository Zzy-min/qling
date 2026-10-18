// ============================================================
// 轻灵 - Guard M2: 工具权限矩阵
// 配置驱动的 per-tool allow/deny/ask，glob 匹配（可选参数级 arg_pattern）
// ============================================================

import { splitShell, unwrap } from "./shell-split.js";

export interface PermissionRule {
  tool_pattern: string;
  decision: "allow" | "deny" | "ask";
  reason?: string;
  /**
   * 参数级 glob：对 bash 为「单段命令」文本（去包装后空格拼接）。
   * 省略时规则作用于整个工具（沿用旧的仅工具名匹配行为）。
   */
  arg_pattern?: string;
}

/**
 * 解析/归一化配置里的权限规则。
 * 安全默认（对标 CWE-1188）：缺省或非法的 decision 一律解析为 deny，
 * 避免漏写字段导致隐式全放行。注意：PermissionMatrix 构造函数的
 * defaultDecision 默认值保持不变（仍是 allow），此函数只作用于「规则条目」。
 */
export function normalizePermissionRules(rules: unknown): PermissionRule[] {
  if (!Array.isArray(rules)) return [];
  const out: PermissionRule[] = [];
  for (const raw of rules) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const toolPattern =
      typeof entry.tool_pattern === "string" ? entry.tool_pattern.trim() : "";
    if (!toolPattern) continue;
    const decision: PermissionRule["decision"] =
      entry.decision === "allow" || entry.decision === "ask" || entry.decision === "deny"
        ? entry.decision
        : "deny";
    const rule: PermissionRule = { tool_pattern: toolPattern, decision };
    if (typeof entry.reason === "string" && entry.reason.trim()) {
      rule.reason = entry.reason;
    }
    if (typeof entry.arg_pattern === "string" && entry.arg_pattern.trim()) {
      rule.arg_pattern = entry.arg_pattern;
    }
    out.push(rule);
  }
  return out;
}

/**
 * Grok 对标：default=ask 时仍自动放行的只读 / 会话内元工具。
 * 不包含 bash/write/patch/browser/url_fetch/subtask 等有副作用工具。
 * 用户显式 deny/ask 规则优先（排在这些规则之前时先匹配）。
 */
export const SAFE_AUTO_ALLOW_TOOLS = [
  "todo",
  "read",
  "search",
  "read_anchored",
  "code_symbols",
  "lsp",
  "bg_list",
  "bg_wait",
  "planner",
  "search_tool",
] as const;

export function buildSafeAutoAllowRules(): PermissionRule[] {
  return SAFE_AUTO_ALLOW_TOOLS.map((tool) => ({
    tool_pattern: tool,
    decision: "allow" as const,
    reason: "built-in safe tool (Grok-style auto-approve)",
  }));
}

export interface PermissionResult {
  decision: "allow" | "deny" | "ask";
  reason?: string;
  matched_rule?: string;
}

export class PermissionMatrix {
  private defaultDecision: "allow" | "deny" | "ask";
  private rules: PermissionRule[];

  constructor(defaultDecision: "allow" | "deny" | "ask" = "allow", rules: PermissionRule[] = []) {
    this.defaultDecision = defaultDecision;
    this.rules = normalizePermissionRules(rules);
  }

  /**
   * 评估工具调用。
   * - 不带参数：仅按工具名匹配（向后兼容）。
   * - bash 且带 command：分段后逐段判定，所有段都命中 allow 才 allow，
   *   任一 deny 即 deny；复杂语法下参数级规则不参与授权。
   */
  evaluate(
    toolName: string,
    args?: Record<string, unknown> | null
  ): PermissionResult {
    const command = extractBashCommand(toolName, args);
    if (command === null) {
      return this.evaluateToolOnly(toolName);
    }
    const { segments, complex } = splitShell(command);
    if (segments.length === 0) {
      return this.evaluateToolOnly(toolName);
    }
    return this.evaluateSegmented(toolName, segments, complex);
  }

  private evaluateToolOnly(toolName: string): PermissionResult {
    for (const rule of this.rules) {
      // 参数级规则在无参数时无法判定，跳过（留给默认 decision）
      if (rule.arg_pattern) continue;
      if (matchGlob(rule.tool_pattern, toolName)) {
        return {
          decision: rule.decision,
          reason: rule.reason,
          matched_rule: rule.tool_pattern,
        };
      }
    }
    return { decision: this.defaultDecision };
  }

  private evaluateSegmented(
    toolName: string,
    segments: string[][],
    complex: boolean
  ): PermissionResult {
    const subjects = segments.map((seg) => unwrap(seg).join(" "));

    // deny 优先：任一段命中 deny 规则即整体 deny（不因规则顺序被 allow 掩盖）
    for (const rule of this.rules) {
      if (rule.decision !== "deny") continue;
      if (!matchGlob(rule.tool_pattern, toolName)) continue;
      if (!this.ruleMatchesAny(rule, subjects, complex)) continue;
      return {
        decision: "deny",
        reason: rule.reason,
        matched_rule: rule.tool_pattern,
      };
    }

    let sawAsk = false;
    let askResult: PermissionResult | null = null;
    for (const subject of subjects) {
      let decision: "allow" | "deny" | "ask" = this.defaultDecision;
      let matchedRule: string | undefined;
      let matchedReason: string | undefined;
      for (const rule of this.rules) {
        if (!matchGlob(rule.tool_pattern, toolName)) continue;
        if (!this.ruleMatchesOne(rule, subject, complex)) continue;
        decision = rule.decision;
        matchedRule = rule.tool_pattern;
        matchedReason = rule.reason;
        break;
      }
      if (decision === "deny") {
        return { decision: "deny", reason: matchedReason, matched_rule: matchedRule };
      }
      if (decision === "ask") {
        sawAsk = true;
        if (!askResult) {
          askResult = { decision: "ask", reason: matchedReason, matched_rule: matchedRule };
        }
      }
    }

    if (sawAsk) return askResult as PermissionResult;
    return { decision: "allow" };
  }

  private ruleMatchesAny(rule: PermissionRule, subjects: string[], complex: boolean): boolean {
    if (!rule.arg_pattern) return true;
    if (complex) return false;
    return subjects.some((subject) => matchGlob(rule.arg_pattern as string, subject));
  }

  private ruleMatchesOne(rule: PermissionRule, subject: string, complex: boolean): boolean {
    if (!rule.arg_pattern) return true;
    // 复杂语法下，「窄参数授权」不得覆盖整段脚本
    if (complex) return false;
    return matchGlob(rule.arg_pattern, subject);
  }
}

function extractBashCommand(
  toolName: string,
  args?: Record<string, unknown> | null
): string | null {
  if (toolName !== "bash" || !args || typeof args !== "object") return null;
  const raw = (args as Record<string, unknown>).command ?? (args as Record<string, unknown>).cmd;
  if (typeof raw !== "string") return null;
  const command = raw.trim();
  return command ? command : null;
}

function matchGlob(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (pattern === value) return true;

  // Convert glob to regex: * -> .*, ? -> ., escape rest
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      regex += ".*";
    } else if (ch === "?") {
      regex += ".";
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      regex += "\\" + ch;
    } else {
      regex += ch;
    }
  }
  regex += "$";

  try {
    return new RegExp(regex).test(value);
  } catch {
    return pattern === value;
  }
}
