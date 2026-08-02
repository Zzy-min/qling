import path from "node:path";

export type FileMutation = "created" | "updated";

export interface ToolExecutionObservation {
  tool: string;
  failed: boolean;
  actionFingerprint?: string;
  failureFingerprint?: string;
  targetPath?: string;
  mutation?: FileMutation;
}

export interface EfficiencySignal {
  code: "SAME_FAILURE_LIMIT" | "TOTAL_FAILURE_LIMIT";
  disposition: "redirect";
  reason: string;
  tool?: string;
  fingerprint?: string;
}

export interface RunEfficiencyOptions {
  sameFailureLimit?: number;
  totalFailureLimit?: number;
  maxCompactions?: number;
  compactionCooldownTurns?: number;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\r?\n/g, " ")
    .replace(/[a-z]:[\\/](?:[^<>:"|?*\r\n]+[\\/])*[^<>:"|?*\r\n]*/gi, "<path>")
    .replace(/(?:\/[^/\s:]+){2,}/g, "<path>")
    .replace(/\b\d+(?:\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

export function normalizeFailureFingerprint(input: {
  tool: string;
  code?: string;
  category?: string;
  message?: string;
}): string {
  return [
    normalizeText(input.tool) || "unknown",
    normalizeText(input.category) || "runtime",
    normalizeText(input.code) || "tool_error",
    normalizeText(input.message) || "unknown_failure",
  ].join(":");
}

export class RunEfficiencyGuard {
  private readonly sameFailureLimit: number;
  private readonly totalFailureLimit: number;
  private readonly maxCompactions: number;
  private readonly compactionCooldownTurns: number;
  private lastFailureKey: string | null = null;
  private consecutiveFailureCount = 0;
  private readonly sideEffects = new Map<string, "created" | "updated" | "created_then_updated">();
  private totalFailures = 0;
  private compactions = 0;
  private lastCompactionTurn: number | null = null;

  constructor(options: RunEfficiencyOptions = {}) {
    this.sameFailureLimit = Math.max(1, options.sameFailureLimit ?? 2);
    this.totalFailureLimit = Math.max(1, options.totalFailureLimit ?? 8);
    this.maxCompactions = Math.max(0, options.maxCompactions ?? 2);
    this.compactionCooldownTurns = Math.max(0, options.compactionCooldownTurns ?? 4);
  }

  recordTools(observations: readonly ToolExecutionObservation[]): EfficiencySignal | null {
    for (const observation of observations) {
      if (observation.targetPath && observation.mutation) {
        const target = path.normalize(observation.targetPath);
        const previous = this.sideEffects.get(target);
        const next =
          previous === "created" && observation.mutation === "updated"
            ? "created_then_updated"
            : previous ?? observation.mutation;
        this.sideEffects.set(target, next);
      }

      if (!observation.failed) {
        this.lastFailureKey = null;
        this.consecutiveFailureCount = 0;
        continue;
      }
      this.totalFailures++;
      const fingerprint =
        observation.failureFingerprint ??
        normalizeFailureFingerprint({ tool: observation.tool, message: "unknown failure" });
      const failureKey = `${observation.actionFingerprint ?? observation.tool}:${fingerprint}`;
      if (failureKey === this.lastFailureKey) {
        this.consecutiveFailureCount++;
      } else {
        this.lastFailureKey = failureKey;
        this.consecutiveFailureCount = 1;
      }

      if (this.consecutiveFailureCount >= this.sameFailureLimit) {
        const count = this.consecutiveFailureCount;
        this.consecutiveFailureCount = 0;
        this.lastFailureKey = null;
        return {
          code: "SAME_FAILURE_LIMIT",
          disposition: "redirect",
          reason: `相同动作连续失败 ${count} 次；禁止原样重试，请更换参数、工具或策略。`,
          tool: observation.tool,
          fingerprint,
        };
      }
      if (this.totalFailures >= this.totalFailureLimit) {
        this.totalFailures = 0;
        return {
          code: "TOTAL_FAILURE_LIMIT",
          disposition: "redirect",
          reason: `近期工具失败累计达到 ${this.totalFailureLimit} 次；请收敛探索范围、汇总证据并切换恢复策略。`,
          tool: observation.tool,
          fingerprint,
        };
      }
    }
    return null;
  }

  canCompact(turn: number): boolean {
    if (this.compactions >= this.maxCompactions) return false;
    if (this.lastCompactionTurn === null) return true;
    return turn - this.lastCompactionTurn >= this.compactionCooldownTurns;
  }

  recordCompaction(turn: number): void {
    this.compactions++;
    this.lastCompactionTurn = turn;
  }

  formatSideEffectLedger(): string {
    if (this.sideEffects.size === 0) return "";
    const labels = {
      created: "创建",
      updated: "更新",
      created_then_updated: "创建后更新",
    } as const;
    const lines = [...this.sideEffects.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([target, mutation]) => `- ${target}：${labels[mutation]}`);
    return [
      "<run_side_effects>",
      "运行时已观测到以下成功文件变更；最终答复必须逐项披露，不得因上下文压缩而遗漏：",
      ...lines,
      "</run_side_effects>",
    ].join("\n");
  }
}
