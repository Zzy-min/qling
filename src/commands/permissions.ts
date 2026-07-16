import { SlashCommand } from "./types.js";
import { formatPermissionMode } from "../statusline.js";
import {
  explainLocalPermissionDecision,
  formatPermissionExplanationReport,
} from "../permissions-report.js";
import {
  formatPermissionPipelineLines,
  getPermissionGrantStore,
} from "../guard/permission-grants.js";
import { openOptionPickerOrFallback } from "../tui/option-picker-helpers.js";

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
  const fromEnv = String(process.env.QLING_GUARD_PERMISSIONS_DEFAULT ?? "allow").toLowerCase();
  if (isMode(fromEnv)) {
    return fromEnv;
  }
  return "allow";
}

function parseEnvPermissionRules(env: NodeJS.ProcessEnv): PermissionRuleInput[] {
  const raw = env.QLING_GUARD_PERMISSIONS_RULES;
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
  aliases: ["/权限", "/allowed-tools"],
  description: "权限：mode · pipeline · grants · explain",
  usage: "/permissions [status|pipeline|grants|forget [tool|all]|allow|deny|ask|explain <tool>]",
  examples: [
    "/permissions",
    "/permissions pipeline",
    "/permissions grants",
    "/permissions forget bash",
    "/permissions explain write",
  ],
  execute: async (args, context) => {
    const first = (args[0] ?? "").toLowerCase();

    const openModePicker = (): boolean => {
      const mode = resolveCurrentMode(context);
      return openOptionPickerOrFallback(
        context,
        {
          title: "权限默认 · Permissions",
          footerHint: "↑/↓ 选择 · Enter 应用 · Esc 取消",
          selectedId: mode,
          items: MODES.map((m) => ({
            id: m,
            label: m,
            description:
              m === "allow"
                ? "自动放行工具"
                : m === "ask"
                  ? "执行前确认"
                  : "默认拒绝",
            active: m === mode,
          })),
          onPick: async (item) => {
            if (!isMode(item.id)) return;
            const setMode = (context.agentLoop as any)?.setPermissionMode;
            if (typeof setMode === "function") {
              await setMode.call(context.agentLoop, item.id);
            }
            process.env.QLING_GUARD_PERMISSIONS_DEFAULT = item.id;
            process.env.QLING_PERMISSIONS_MODE = item.id;
            const apply = (
              context as {
                applySessionChrome?: (p: Record<string, string>) => void;
              }
            ).applySessionChrome;
            if (typeof apply === "function") {
              const sessionMode =
                typeof (context.agentLoop as any)?.isPlanMode === "function" &&
                (context.agentLoop as any).isPlanMode()
                  ? "plan"
                  : "agent";
              apply({ sessionMode, permissionMode: item.id });
            }
            context.writeLine(`🔐 权限默认 → ${formatPermissionMode(item.id)}`);
          },
        },
        () => {
          context.writeLine("");
          context.writeLine("🔐 【权限模式】");
          context.writeLine("-----------------------------------------");
          context.writeLine(`Default   : ${formatPermissionMode(mode)}`);
          context.writeLine("切换: /permissions allow|ask|deny");
          context.writeLine("-----------------------------------------");
          context.writeLine("");
        }
      );
    };

    // 默认 → 权限 mode 切换器
    if (!first || first === "status" || first === "pick" || first === "ui" || first === "list") {
      openModePicker();
      return;
    }

    if (first === "pipeline" || first === "流水线" || first === "flow") {
      for (const line of formatPermissionPipelineLines()) {
        context.writeLine(line);
      }
      const mode = resolveCurrentMode(context);
      context.writeLine(`当前默认 mode : ${formatPermissionMode(mode)}`);
      const grants = getPermissionGrantStore().list();
      context.writeLine(`会话 grants   : ${grants.length}`);
      context.writeLine("");
      return;
    }

    if (first === "grants" || first === "grant" || first === "授权") {
      const grants = getPermissionGrantStore().list();
      context.writeLine("");
      context.writeLine("🔑 【会话 Remembered Grants】");
      context.writeLine("-----------------------------------------");
      if (!grants.length) {
        context.writeLine("(无) · 用户批准工具后会记录于此");
      } else {
        for (const g of grants) {
          const when = new Date(g.grantedAt).toLocaleString();
          context.writeLine(`- ${g.toolName}  allow  @ ${when}${g.reason ? `  (${g.reason})` : ""}`);
        }
      }
      context.writeLine("-----------------------------------------");
      context.writeLine("清除: /permissions forget <tool|all>");
      context.writeLine("");
      return;
    }

    if (first === "forget" || first === "revoke" || first === "清除") {
      const target = (args[1] ?? "").trim();
      if (!target) {
        context.writeError("用法: /permissions forget <tool|all>");
        return;
      }
      const store = getPermissionGrantStore();
      if (target === "all" || target === "*") {
        const n = store.clear();
        context.writeLine(`已清除 ${n} 条会话 grant`);
        return;
      }
      const ok = store.forget(target);
      context.writeLine(ok ? `已清除 grant: ${target}` : `无 grant: ${target}`);
      return;
    }

    if (first === "explain" || first === "解释") {
      const toolName = args[1];
      if (!toolName) {
        context.writeError("❌ 用法: /permissions explain <tool>");
        return;
      }
      const report = explainLocalPermissionDecision(
        {
          defaultMode: resolveCurrentMode(context),
          rules: parseEnvPermissionRules(process.env),
          env: process.env,
        },
        toolName
      );
      for (const line of formatPermissionExplanationReport(report)) {
        context.writeLine(line);
      }
      const grant = getPermissionGrantStore().get(toolName);
      if (grant) {
        context.writeLine(`Grant     : session allow @ ${new Date(grant.grantedAt).toLocaleString()}`);
      } else {
        context.writeLine("Grant     : (无会话授权)");
      }
      context.writeLine("");
      return;
    }

    if (!isMode(first)) {
      context.writeError(
        "❌ 用法: /permissions [status|pipeline|grants|forget|allow|deny|ask|explain <tool>]"
      );
      return;
    }

    const setMode = (context.agentLoop as any)?.setPermissionMode;
    if (typeof setMode === "function") {
      await setMode.call(context.agentLoop, first);
    }
    process.env.QLING_GUARD_PERMISSIONS_DEFAULT = first;
    process.env.QLING_PERMISSIONS_MODE = first;

    // 同步顶栏 auto/normal（若 TUI 注入了 chrome）
    const apply = (context as { applySessionChrome?: (p: Record<string, string>) => void })
      .applySessionChrome;
    if (typeof apply === "function") {
      const sessionMode =
        typeof (context.agentLoop as any)?.isPlanMode === "function" &&
        (context.agentLoop as any).isPlanMode()
          ? "plan"
          : "agent";
      apply({ sessionMode, permissionMode: first });
    }

    const mode = resolveCurrentMode(context);
    context.writeLine("");
    context.writeLine(`🔐 权限默认策略已切换为: ${formatPermissionMode(mode)}`);
    context.writeLine("说明: 后续工具调用将按新策略执行（进程内）。");
    context.writeLine("");
  },
};
