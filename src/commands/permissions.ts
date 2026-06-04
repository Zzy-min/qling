import { SlashCommand } from "./types.js";
import { formatPermissionMode } from "../statusline.js";
import {
  explainLocalPermissionDecision,
  formatPermissionExplanationReport,
} from "../permissions-report.js";

type PermissionMode = "allow" | "deny" | "ask";
type PermissionRuleInput = {
  tool_pattern?: string;
  decision?: string;
  reason?: string;
};

const MODES: PermissionMode[] = ["allow", "deny", "ask"];

function isMode(value: string): value is PermissionMode {
  return MODES.includes(value as PermissionMode);
}

function resolveCurrentMode(context: any): PermissionMode {
  const fromLoop = context.agentLoop?.getPermissionMode?.();
  if (typeof fromLoop === "string" && isMode(fromLoop.toLowerCase())) {
    return fromLoop.toLowerCase() as PermissionMode;
  }
  const fromEnv = String(process.env.QINGLING_GUARD_PERMISSIONS_DEFAULT ?? "allow").toLowerCase();
  if (isMode(fromEnv)) {
    return fromEnv;
  }
  return "allow";
}

function parseEnvPermissionRules(env: NodeJS.ProcessEnv): PermissionRuleInput[] {
  const raw = env.QINGLING_GUARD_PERMISSIONS_RULES;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is PermissionRuleInput => Boolean(entry && typeof entry === "object"));
  } catch {
    return [];
  }
}

export const permissionsCommand: SlashCommand = {
  name: "/permissions",
  aliases: ["/权限"],
  description: "查看或切换工具权限默认策略",
  usage: "/permissions [status|allow|deny|ask|explain <tool>]",
  execute: async (args, context) => {
    const first = (args[0] ?? "status").toLowerCase();
    if (first === "explain" || first === "解释") {
      const toolName = args[1];
      if (!toolName) {
        context.writeError("❌ 用法: /permissions explain <tool>");
        return;
      }
      const report = explainLocalPermissionDecision({
        defaultMode: resolveCurrentMode(context),
        rules: parseEnvPermissionRules(process.env),
        env: process.env,
      }, toolName);
      for (const line of formatPermissionExplanationReport(report)) {
        context.writeLine(line);
      }
      return;
    }

    if (first === "status") {
      const mode = resolveCurrentMode(context);
      context.writeLine("");
      context.writeLine("🔐 【权限模式】");
      context.writeLine("-----------------------------------------");
      context.writeLine(`Default   : ${formatPermissionMode(mode)}`);
      context.writeLine("说明      : allow=自动放行, ask=询问确认, deny=默认拒绝");
      context.writeLine("-----------------------------------------");
      context.writeLine("");
      return;
    }

    if (!isMode(first)) {
      context.writeError("❌ 用法: /permissions [status|allow|deny|ask|explain <tool>]");
      return;
    }

    const setMode = (context.agentLoop as any)?.setPermissionMode;
    if (typeof setMode === "function") {
      await setMode.call(context.agentLoop, first);
    }
    process.env.QINGLING_GUARD_PERMISSIONS_DEFAULT = first;
    process.env.QINGLING_PERMISSIONS_MODE = first;

    const mode = resolveCurrentMode(context);
    context.writeLine("");
    context.writeLine(`🔐 权限默认策略已切换为: ${formatPermissionMode(mode)}`);
    context.writeLine("说明: 后续工具调用将按新策略执行。");
    context.writeLine("");
  },
};
