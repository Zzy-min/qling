import path from "node:path";

export type FileMutation = "created" | "updated";

export interface ToolExecutionObservation {
  tool: string;
  failed: boolean;
  failureFingerprint?: string;
  targetPath?: string;
  mutation?: FileMutation;
}

export interface EfficiencyStop {
  code: "SAME_FAILURE_LIMIT" | "TOTAL_FAILURE_LIMIT";
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
    .replace(/\r?\n[\s\S]*/g, "")
    .replace(/[a-z]:[\\/](?:[^<>:"|?*\r\n]+[\\/])*[^<>:"|?*\r\n]*/gi, "<path>")
    .replace(/(?:\/[^/\s:]+){2,}/g, "<path>")
    .replace(/\b\d+(?:\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
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
  private readonly failureCounts = new Map<string, number>();
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

  recordTools(observations: readonly ToolExecutionObservation[]): EfficiencyStop | null {
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

      if (!observation.failed) continue;
      this.totalFailures++;
      const fingerprint =
        observation.failureFingerprint ??
        normalizeFailureFingerprint({ tool: observation.tool, message: "unknown failure" });
      const count = (this.failureCounts.get(fingerprint) ?? 0) + 1;
      this.failureCounts.set(fingerprint, count);

      if (count >= this.sameFailureLimit) {
        return {
          code: "SAME_FAILURE_LIMIT",
          reason: `同类失败已出现 ${count} 次，已停止继续试错。`,
          tool: observation.tool,
          fingerprint,
        };
      }
      if (this.totalFailures >= this.totalFailureLimit) {
        return {
          code: "TOTAL_FAILURE_LIMIT",
          reason: `本次运行已达到 ${this.totalFailureLimit} 次工具失败预算，已暂停。`,
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
