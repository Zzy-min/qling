// ============================================================
// G3.3 — 会话级 Remembered Grant（用户批准后本会话免再问）
// ============================================================

export type GrantScope = "session";

export interface PermissionGrant {
  toolName: string;
  /** 归一化小写工具名 */
  key: string;
  decision: "allow";
  scope: GrantScope;
  grantedAt: number;
  reason?: string;
}

function normalizeTool(name: string): string {
  return String(name ?? "")
    .trim()
    .toLowerCase();
}

export class PermissionGrantStore {
  private readonly grants = new Map<string, PermissionGrant>();

  remember(
    toolName: string,
    options: { reason?: string; scope?: GrantScope } = {}
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
      grantedAt: Date.now(),
      reason: options.reason,
    };
    this.grants.set(key, grant);
    return { ...grant };
  }

  hasAllow(toolName: string): boolean {
    return this.grants.has(normalizeTool(toolName));
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
