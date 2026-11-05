// ============================================================
// G3.3 — 会话级 Remembered Grant（用户批准后本会话免再问）
// ============================================================

import path from "node:path";
import { splitShell } from "./shell-split.js";

export type GrantScope = "session";

export interface PermissionGrant {
  toolName: string;
  /** 归一化小写工具名 */
  key: string;
  decision: "allow";
  scope: GrantScope;
  /** 绑定会话；旧数据缺失时按进程内兼容处理。 */
  sessionId?: string;
  /** 动作/资源级作用域；缺失时表示旧式工具级 grant。 */
  scopeKey?: string;
  grantedAt: number;
  reason?: string;
}

function normalizeTool(name: string): string {
  return String(name ?? "")
    .trim()
    .toLowerCase();
}

/**
 * grant 复用边界（对标 Grok「宽脚本不得命中窄授权」）：
 * bash 仅在命令是单段且非复杂语法时复用；多段 / `$(...)` / `bash -c` 等
 * 必须重新走审批。非 bash 工具维持原行为。
 */
function isGrantReusableFor(
  toolName: string,
  args?: Record<string, unknown> | null
): boolean {
  if (normalizeTool(toolName) === "computer_use") return false;
  if (normalizeTool(toolName) === "url_fetch") {
    return ["GET", "HEAD"].includes(String(args?.method ?? "GET").trim().toUpperCase());
  }
  if (normalizeTool(toolName) !== "bash") return true;
  const record = args && typeof args === "object" ? (args as Record<string, unknown>) : null;
  const raw = record?.command ?? record?.cmd;
  if (typeof raw !== "string" || !raw.trim()) {
    // 无命令信息：无法判定，沿用旧行为
    return true;
  }
  const { segments, complex } = splitShell(raw);
  if (complex) return false;
  if (segments.length > 1) return false;
  return true;
}

/**
 * 生成动作/资源作用域；无法安全表达时返回 undefined（不允许复用）。
 * - bash：规范化单段命令（复杂脚本不复用）
 * - read/write/patch：目标路径
 * - url_fetch：METHOD + URL
 */
export function grantActionKey(
  toolName: string,
  args?: Record<string, unknown> | null
): string | undefined {
  const tool = normalizeTool(toolName);
  const record = args && typeof args === "object" ? args : null;
  if (!record || tool === "computer_use") return undefined;
  if (tool === "bash") {
    const raw = record.command ?? record.cmd;
    if (typeof raw !== "string" || !raw.trim()) return undefined;
    const { segments, complex } = splitShell(raw);
    if (complex || segments.length !== 1) return undefined;
    // 用 argv 结构而不是拼接字符串：引号内多空格、空参数等不能被折叠成同一动作。
    const argv = segments[0] ?? [];
    const cwd = typeof record.cwd === "string" && record.cwd.trim()
      ? path.resolve(record.cwd)
      : process.cwd();
    return `bash:${cwd.replace(/\\/g, "/")}:${JSON.stringify(argv)}`;
  }
  if (["read", "read_anchored", "write", "patch", "patch_anchored"].includes(tool)) {
    const target = record.path ?? record.file;
    if (typeof target !== "string" || !target.trim()) return undefined;
    const base = typeof record.cwd === "string" && record.cwd.trim()
      ? record.cwd
      : process.cwd();
    return `${tool}:${path.resolve(base, target.trim()).replace(/\\/g, "/")}`;
  }
  if (tool === "url_fetch") {
    const url = record.url;
    if (typeof url !== "string" || !url.trim()) return undefined;
    const method = String(record.method ?? "GET").trim().toUpperCase();
    return `url_fetch:${method}:${url.trim()}`;
  }
  return undefined;
}

export class PermissionGrantStore {
  private readonly grants = new Map<string, PermissionGrant>();

  remember(
    toolName: string,
    options: { reason?: string; scope?: GrantScope; sessionId?: string; arguments?: Record<string, unknown> | null } = {}
  ): PermissionGrant {
    const key = normalizeTool(toolName);
    if (!key) {
      throw new Error("toolName is required");
    }
    const grant: PermissionGrant = {
      toolName: String(toolName).trim(),
      key,
      decision: "allow",
      scope: options.scope ?? "session",
      sessionId: options.sessionId,
      scopeKey: grantActionKey(toolName, options.arguments),
      grantedAt: Date.now(),
      reason: options.reason,
    };
    this.grants.set(key, grant);
    return { ...grant };
  }

  hasAllow(
    toolName: string,
    args?: Record<string, unknown> | null,
    sessionId?: string
  ): boolean {
    const grant = this.grants.get(normalizeTool(toolName));
    if (!grant) return false;
    // 新 grant 绑定会话；缺失会话的旧 grant 不得进入已标识会话。
    if (grant.sessionId) {
      if (!sessionId || grant.sessionId !== sessionId) return false;
    } else if (sessionId) {
      return false;
    }
    // 动作/资源级 grant：命令、路径或 URL 变化必须重新审批。
    if (grant.scopeKey) {
      const current = grantActionKey(toolName, args);
      if (current !== grant.scopeKey) return false;
    } else if (args && Object.keys(args).length > 0) {
      // 无作用域键的旧 grant 只能覆盖无参数调用，不能放行任意具体动作。
      return false;
    }
    return isGrantReusableFor(toolName, args);
  }

  get(toolName: string): PermissionGrant | null {
    const g = this.grants.get(normalizeTool(toolName));
    return g ? { ...g } : null;
  }

  list(): PermissionGrant[] {
    return [...this.grants.values()]
      .sort((a, b) => b.grantedAt - a.grantedAt)
      .map((g) => ({ ...g }));
  }

  forget(toolName: string): boolean {
    return this.grants.delete(normalizeTool(toolName));
  }

  clear(): number {
    const n = this.grants.size;
    this.grants.clear();
    return n;
  }
}

/** 权限流水线阶段（文档与 /permissions pipeline 共用） */
export const PERMISSION_PIPELINE_STAGES = [
  {
    id: "plan",
    title: "Plan Mode",
    detail: "硬拒绝 bash/subtask/browser/bg_kill；write/patch 仅计划目录",
  },
  {
    id: "rules",
    title: "Permission rules",
    detail: "QLING_GUARD 规则矩阵 + 默认 mode（allow|ask|deny）+ 内置安全工具 allow（todo/read/search…）",
  },
  {
    id: "grant",
    title: "Remembered grant",
    detail: "本会话用户已批准的工具 → 自动 allow，跳过再次 ask",
  },
  {
    id: "rate_limit",
    title: "Rate limit",
    detail: "可选频率限制",
  },
  {
    id: "classifier",
    title: "Speculative classifier",
    detail: "危险模式 → deny 或 ask",
  },
  {
    id: "hooks",
    title: "Custom PreToolUse",
    detail: "用户/插件注册的 hook",
  },
  {
    id: "mode",
    title: "Session mode",
    detail: "normal=默认 ask（只读/todo 内置放行）· auto=默认 allow · plan 覆盖写能力",
  },
] as const;

let singleton: PermissionGrantStore | null = null;

export function getPermissionGrantStore(): PermissionGrantStore {
  if (!singleton) singleton = new PermissionGrantStore();
  return singleton;
}

export function resetPermissionGrantStoreForTests(): void {
  singleton = null;
}

export function formatPermissionPipelineLines(): string[] {
  const lines = [
    "",
    "🔐 权限流水线（G3.3）",
    "-----------------------------------------",
  ];
  PERMISSION_PIPELINE_STAGES.forEach((stage, i) => {
    lines.push(`${i + 1}. [${stage.id}] ${stage.title}`);
    lines.push(`   ${stage.detail}`);
  });
  lines.push("-----------------------------------------");
  lines.push("边界: 进程内；grant 不落盘；不写默认配置文件。");
  lines.push("");
  return lines;
}
