// ============================================================
// 轻灵 - 本地评测类型（不依赖外部 LLM）
// ============================================================

export type EvalStatus = "pass" | "fail" | "skip";

export interface EvalTaskContext {
  /** 临时工作目录（由 runner 提供） */
  workspaceDir: string;
  env: NodeJS.ProcessEnv;
}

export interface EvalTaskOutcome {
  ok: boolean;
  detail: string;
  /** 显式跳过（如无 API key）；不计入 fail */
  skip?: boolean;
}

export interface EvalTask {
  id: string;
  title: string;
  /** 默认本地 smoke；可选任务可 skip */
  run: (ctx: EvalTaskContext) => Promise<EvalTaskOutcome>;
}

export interface EvalTaskResult {
  id: string;
  title: string;
  status: EvalStatus;
  detail: string;
  durationMs: number;
}

/** Describes exactly what an eval result is allowed to prove. */
export interface EvalEvidenceProfile {
  executor: "component" | "harness" | "agent";
  model: "none" | "fake" | "real";
  verifier: "assertion" | "environment" | "model" | "human";
  claim: string;
  limitations: string[];
}

export interface EvalReport {
  total: number;
  pass: number;
  fail: number;
  skip: number;
  results: EvalTaskResult[];
  durationMs: number;
  evidence?: EvalEvidenceProfile;
}
