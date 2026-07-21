// ============================================================
// 轻灵 - Guard M2: 工具权限矩阵
// 配置驱动的 per-tool allow/deny/ask，glob 匹配
// ============================================================

export interface PermissionRule {
  tool_pattern: string;
  decision: "allow" | "deny" | "ask";
  reason?: string;
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
    this.rules = rules;
  }

  evaluate(toolName: string): PermissionResult {
    for (const rule of this.rules) {
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
