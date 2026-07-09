// ============================================================
// 轻灵 - 本地评测类型（不依赖外部 LLM）
// ============================================================

export type EvalStatus = "pass" | "fail" | "skip";

export interface EvalTaskContext {
  /** 临时工作目录（由 runner 提供） */
  workspaceDir: string;
  env: NodeJS.ProcessEnv;
}

export interface EvalTask {
  id: string;
  title: string;
  /** 纯本地、无网络、无真实 LLM */
  run: (ctx: EvalTaskContext) => Promise<{ ok: boolean; detail: string }>;
}

export interface EvalTaskResult {
  id: string;
  title: string;
  status: EvalStatus;
  detail: string;
  durationMs: number;
}

export interface EvalReport {
  total: number;
  pass: number;
  fail: number;
  skip: number;
  results: EvalTaskResult[];
  durationMs: number;
}
