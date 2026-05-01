// ============================================================
// 轻灵 - Guard M2: 工具权限矩阵
// 配置驱动的 per-tool allow/deny/ask，glob 匹配
// ============================================================

export interface PermissionRule {
  tool_pattern: string;
  decision: "allow" | "deny" | "ask";
  reason?: string;
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
