import { formatPermissionMode } from "./statusline.js";
import { PermissionMatrix, type PermissionRule } from "./guard/permissions.js";

type PermissionRuleLike = {
  tool_pattern?: string;
  decision?: string;
  reason?: string;
};

type PermissionDecision = "allow" | "deny" | "ask";

export interface LocalPermissionsReport {
  defaultMode: string;
  rules: Array<{
    toolPattern: string;
    decision: string;
    reason: string | null;
  }>;
  env: {
    guardDefault: string | null;
    compatMode: string | null;
  };
}

export interface LocalPermissionsReportInput {
  defaultMode: string;
  rules?: PermissionRuleLike[];
  env?: Record<string, string | undefined>;
}

export interface PermissionExplanationReport {
  toolName: string;
  decision: PermissionDecision;
  matchedRule: string;
  reason: string;
  effect: string;
  defaultMode: PermissionDecision;
  ruleCount: number;
  env: {
    guardDefault: string | null;
    compatMode: string | null;
  };
}

function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeDecision(value: unknown, fallback: PermissionDecision): PermissionDecision {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "allow" || normalized === "deny" || normalized === "ask") {
    return normalized;
  }
  return fallback;
}

function normalizeRules(rules: PermissionRuleLike[] | undefined): PermissionRule[] {
  return (rules ?? []).map((rule) => ({
    tool_pattern: safeText(rule.tool_pattern, "*"),
    decision: normalizeDecision(rule.decision, "ask"),
    reason: safeText(rule.reason, ""),
  })).map((rule) => ({
    ...rule,
    reason: rule.reason || undefined,
  }));
}

function effectForDecision(decision: PermissionDecision): string {
  if (decision === "allow") return "自动放行";
  if (decision === "deny") return "默认拒绝执行";
  return "执行前要求确认";
}

function reasonForDecision(decision: PermissionDecision, matchedRule: string): string {
  if (matchedRule === "default") {
    return `未命中具体规则，使用默认策略：${effectForDecision(decision)}。`;
  }
  return "命中本地权限规则。";
}

export function buildLocalPermissionsReport(input: LocalPermissionsReportInput): LocalPermissionsReport {
  const env = input.env ?? process.env;
  return {
    defaultMode: safeText(input.defaultMode, "allow"),
    rules: (input.rules ?? []).map((rule) => ({
      toolPattern: safeText(rule.tool_pattern, "*"),
      decision: safeText(rule.decision, "ask"),
      reason: safeText(rule.reason, ""),
    })).map((rule) => ({
      ...rule,
      reason: rule.reason || null,
    })),
    env: {
      guardDefault: safeText(env.QINGLING_GUARD_PERMISSIONS_DEFAULT, "") || null,
      compatMode: safeText(env.QINGLING_PERMISSIONS_MODE, "") || null,
    },
  };
}

export function explainLocalPermissionDecision(
  input: LocalPermissionsReportInput,
  toolName: string
): PermissionExplanationReport {
  const env = input.env ?? process.env;
  const defaultMode = normalizeDecision(input.defaultMode, "allow");
  const rules = normalizeRules(input.rules);
  const normalizedToolName = safeText(toolName, "-");
  const result = new PermissionMatrix(defaultMode, rules).evaluate(normalizedToolName);
  const decision = normalizeDecision(result.decision, defaultMode);
  const matchedRule = result.matched_rule ?? "default";

  return {
    toolName: normalizedToolName,
    decision,
    matchedRule,
    reason: safeText(result.reason, reasonForDecision(decision, matchedRule)),
    effect: effectForDecision(decision),
    defaultMode,
    ruleCount: rules.length,
    env: {
      guardDefault: safeText(env.QINGLING_GUARD_PERMISSIONS_DEFAULT, "") || null,
      compatMode: safeText(env.QINGLING_PERMISSIONS_MODE, "") || null,
    },
  };
}

export function formatLocalPermissionsReport(report: LocalPermissionsReport): string[] {
  const lines = [
    "",
    "🔐 本地权限状态",
    "-----------------------------------------",
    `Default   : ${formatPermissionMode(report.defaultMode)}`,
    `Rules     : ${report.rules.length}`,
    `Env       : QINGLING_GUARD_PERMISSIONS_DEFAULT=${report.env.guardDefault ?? "-"}`,
    `Compat    : QINGLING_PERMISSIONS_MODE=${report.env.compatMode ?? "-"}`,
    "说明      : allow=自动放行, ask=询问确认, deny=默认拒绝",
    "",
  ];

  if (report.rules.length === 0) {
    lines.push("(无规则)");
  } else {
    report.rules.forEach((rule, index) => {
      const suffix = rule.reason ? ` | ${rule.reason}` : "";
      lines.push(`${index + 1}. ${rule.toolPattern} -> ${rule.decision}${suffix}`);
    });
  }

  lines.push("-----------------------------------------");
  lines.push("边界      : 只读取当前本地配置与环境变量；不修改配置、不调用模型、不联网。");
  lines.push("");
  return lines;
}

export function formatPermissionExplanationReport(report: PermissionExplanationReport): string[] {
  return [
    "",
    "🔎 权限解释",
    "-----------------------------------------",
    `Tool      : ${report.toolName}`,
    `Decision  : ${formatPermissionMode(report.decision)}`,
    `Matched   : ${report.matchedRule}`,
    `Reason    : ${report.reason}`,
    `Effect    : ${report.effect}`,
    `Default   : ${formatPermissionMode(report.defaultMode)}`,
    `Rules     : ${report.ruleCount}`,
    `Env       : QINGLING_GUARD_PERMISSIONS_DEFAULT=${report.env.guardDefault ?? "-"}`,
    `Compat    : QINGLING_PERMISSIONS_MODE=${report.env.compatMode ?? "-"}`,
    "-----------------------------------------",
    "边界      : 只读取当前本地配置与环境变量；不执行工具、不修改配置、不调用模型、不联网。",
    "",
  ];
}
