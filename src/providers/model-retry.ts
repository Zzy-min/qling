// Model-call classification, backoff, and retry/fallback wrapper.
// No outbound endpoints are introduced here; fallback only swaps the model id.

export type ModelErrorKind =
  | "network"
  | "rate_limited"
  | "server"
  | "stream_interrupted"
  | "auth"
  | "bad_request"
  | "context_length"
  | "content_policy"
  | "canceled";

export interface ModelErrorClassification {
  kind: ModelErrorKind;
  retryable: boolean;
  retryAfterMs?: number;
  status?: number;
  requestId?: string;
  code?: string;
}

export interface ModelRetryPolicy {
  maxRetries: number;
  baseMs: number;
  maxDelayMs: number;
  retryAfterMaxMs: number;
  maxElapsedMs: number;
  runRetryBudget: number;
  fallbackModels: string[];
  streamIdleMs: number;
}

export interface BackoffDecision {
  delayMs: number;
  retryAfterExhausted: boolean;
}

export interface ModelRetryRunBudget {
  remaining: number;
}

export type ModelRetryEvent =
  | {
      type: "model_retry";
      attempt: number;
      max: number;
      delayMs: number;
      kind: ModelErrorKind;
      status?: number;
      requestId?: string;
      model: string;
    }
  | {
      type: "model_fallback";
      from: string;
      to: string;
      reason: string;
    }
  | {
      type: "model_retry_recovered";
      attempts: number;
      elapsedMs: number;
      model: string;
    }
  | {
      type: "model_retry_exhausted";
      attempts: number;
      elapsedMs: number;
      lastKind: ModelErrorKind;
      models: string[];
      model?: string;
      status?: number;
      requestId?: string;
    };

export interface CallModelWithRetryOptions<T> {
  call: (model: string, attempt: number) => Promise<T>;
  policy: ModelRetryPolicy;
  models: string[];
  signal?: AbortSignal;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  rng?: () => number;
  onEvent?: (event: ModelRetryEvent) => void;
  runBudget?: ModelRetryRunBudget;
  /** Extra cap applied as min(policy.maxRetries, retryCap). */
  retryCap?: number;
  allowFallback?: boolean;
  costExhausted?: () => boolean;
}

const RETRYABLE_KINDS = new Set<ModelErrorKind>([
  "network",
  "rate_limited",
  "server",
  "stream_interrupted",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function isCanceledError(error: unknown): boolean {
  const record = asRecord(error);
  if (!record) return false;
  return record.name === "AgentRunCanceledError"
    || record.code === "ERR_CANCELED"
    || record.code === "ABORT_ERR"
    || record.aborted === true;
}

export function canceledRequestError(): Error {
  const canceled = new Error("LLM request canceled");
  canceled.name = "AgentRunCanceledError";
  return canceled;
}

function readStatus(record: Record<string, unknown> | null): number | undefined {
  if (!record) return undefined;
  const direct = record.status ?? record.statusCode;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const nested = asRecord(record.error);
  const nestedStatus = nested?.status ?? nested?.statusCode;
  if (typeof nestedStatus === "number" && Number.isFinite(nestedStatus)) return nestedStatus;
  return undefined;
}

function readCode(record: Record<string, unknown> | null): string {
  if (!record) return "";
  const nested = asRecord(record.error);
  return readString(record.code)
    || readString(nested?.code)
    || readString(record.type)
    || readString(nested?.type);
}

function readRetryAfter(record: Record<string, unknown> | null): number | undefined {
  if (!record) return undefined;
  const value = record.retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function classifyModelError(error: unknown): ModelErrorClassification {
  const record = asRecord(error);
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code = readCode(record);
  const status = readStatus(record);
  const requestId = readString(record?.requestId) || undefined;
  const retryAfterMs = readRetryAfter(record);
  const blob = `${message}\n${code}`.toLowerCase();
  const base = { status, requestId, code: code || undefined, retryAfterMs };

  if (isCanceledError(error)) {
    return { ...base, kind: "canceled", retryable: false };
  }
  if (/context_length_exceeded|context_length|maximum context|too many tokens|context length/.test(blob)) {
    return { ...base, kind: "context_length", retryable: false };
  }
  if (/content[_ ]filter|content[_ ]policy|\bsafety\b|\bpolicy\b/.test(blob)) {
    return { ...base, kind: "content_policy", retryable: false };
  }
  if (
    status === 401
    || status === 403
    || /authentication_error|invalid_api_key|permission_error/.test(blob)
  ) {
    return { ...base, kind: "auth", retryable: false, status: status ?? 401 };
  }
  if (/invalid_request_error/.test(blob)) {
    return { ...base, kind: "bad_request", retryable: false, status: status ?? 400 };
  }
  if (
    code === "stream_interrupted"
    || code === "upstream_stream_error"
    || /upstream stream error|stream interrupted|stream ended before|stream idle/.test(blob)
  ) {
    return { ...base, kind: "stream_interrupted", retryable: true };
  }
  if (status === 429 || /rate[_ ]limit|too many requests/.test(blob)) {
    return { ...base, kind: "rate_limited", retryable: true, status: status ?? 429 };
  }
  if (status !== undefined && status >= 500) {
    return { ...base, kind: "server", retryable: true };
  }
  const transportCode = /\b(?:econnreset|etimedout|eai_again|econnrefused|enotfound|epipe|econnaborted)\b/.test(blob)
    || /socket hang up|network error|fetch failed/.test(blob);
  if (transportCode || (status === undefined && /timeout/.test(blob)) || (status === undefined && record?.retriable === true)) {
    return { ...base, kind: "network", retryable: true };
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return { ...base, kind: "bad_request", retryable: false };
  }
  if (record?.retriable === true) {
    return { ...base, kind: "network", retryable: true };
  }
  return { ...base, kind: "bad_request", retryable: false };
}

export function parseRetryAfterMs(value: unknown, nowMs: number = Date.now()): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : undefined;
}

function readBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.trunc(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function readStreamIdleMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 120_000;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 120_000;
  if (value === 0) return 0;
  return Math.min(1_800_000, Math.round(value));
}

/**
 * Defaults apply only when the variable is missing or not a number.
 * `QLING_LLM_MAX_RETRIES` is still forced to 3 by config.ts when the CLI boots;
 * direct AgentLoop/SDK construction without that env uses 5.
 */
export function resolveModelRetryPolicy(env: NodeJS.ProcessEnv = process.env): ModelRetryPolicy {
  const fallbackModels = readString(env.QLING_LLM_FALLBACK_MODELS)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
  return {
    maxRetries: readBoundedInt(env.QLING_LLM_MAX_RETRIES, 5, 0, 20),
    baseMs: readBoundedInt(env.QLING_LLM_RETRY_BASE_MS, 1000, 100, 10_000),
    maxDelayMs: readBoundedInt(env.QLING_LLM_RETRY_MAX_DELAY_MS, 30_000, 1000, 120_000),
    retryAfterMaxMs: readBoundedInt(env.QLING_LLM_RETRY_AFTER_MAX_MS, 60_000, 0, 600_000),
    maxElapsedMs: readBoundedInt(env.QLING_LLM_RETRY_MAX_ELAPSED_MS, 300_000, 0, 1_800_000),
    runRetryBudget: readBoundedInt(env.QLING_LLM_RUN_RETRY_BUDGET, 20, 0, 200),
    fallbackModels,
    streamIdleMs: readStreamIdleMs(env.QLING_LLM_STREAM_IDLE_MS),
  };
}

export function resolveStreamIdleMs(env: NodeJS.ProcessEnv = process.env): number {
  return resolveModelRetryPolicy(env).streamIdleMs;
}

export function computeBackoffMs(
  attempt: number,
  policy: Pick<ModelRetryPolicy, "baseMs" | "maxDelayMs" | "retryAfterMaxMs">,
  retryAfterMs: number | undefined,
  rng: () => number = Math.random,
): BackoffDecision {
  if (retryAfterMs !== undefined && retryAfterMs > policy.retryAfterMaxMs) {
    return { delayMs: 0, retryAfterExhausted: true };
  }
  const safeAttempt = Math.max(1, Math.trunc(attempt) || 1);
  const exponential = policy.baseMs * 2 ** (safeAttempt - 1);
  const capped = Math.min(policy.maxDelayMs, exponential);
  const sample = Math.min(1, Math.max(0, rng()));
  const jitter = 0.8 + sample * 0.4;
  let delayMs = Math.round(capped * jitter);
  if (retryAfterMs !== undefined) delayMs = Math.max(retryAfterMs, delayMs);
  return { delayMs, retryAfterExhausted: false };
}

export class ModelRetryError extends Error {
  readonly modelRetryExhausted = true;
  readonly modelRetryHandled = true;
  readonly attempts: number;
  readonly retries: number;
  readonly lastKind: ModelErrorKind;
  readonly modelsTried: string[];
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly retriable: boolean;
  readonly retryAfterMs?: number;

  constructor(options: {
    message: string;
    attempts: number;
    retries: number;
    lastKind: ModelErrorKind;
    modelsTried: string[];
    status?: number;
    code?: string;
    requestId?: string;
    retriable: boolean;
    retryAfterMs?: number;
  }) {
    super(options.message);
    this.name = "ModelRetryError";
    this.attempts = options.attempts;
    this.retries = options.retries;
    this.lastKind = options.lastKind;
    this.modelsTried = options.modelsTried;
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.retriable = options.retriable;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function isModelRetryTerminal(error: unknown): boolean {
  const record = asRecord(error);
  return record?.modelRetryExhausted === true || record?.modelRetryHandled === true;
}

export function formatModelCallFailure(error: unknown, sessionId: string, saved: boolean): string {
  const record = asRecord(error);
  const kind = readString(record?.lastKind) || "unknown";
  const status = typeof record?.status === "number" ? String(record.status) : "";
  const code = readString(record?.code);
  const statusCode = status && code && status !== code ? `${status}/${code}` : status || code || "n/a";
  const requestId = readString(record?.requestId);
  const request = requestId ? `，request-id ${requestId}` : "";
  const attempts = typeof record?.attempts === "number" ? record.attempts : 1;
  const retries = typeof record?.retries === "number" ? record.retries : Math.max(0, attempts - 1);
  const models = Array.isArray(record?.modelsTried)
    ? record.modelsTried.filter((item): item is string => typeof item === "string")
    : [];
  const savedText = saved
    ? `会话已保存为 ${sessionId}，已完成的工具结果均保留。`
    : `会话保存失败（id ${sessionId}），已完成的工具结果仍留在当前进程内存中。`;
  let text =
    `模型调用失败：${kind}（${statusCode}${request}），已重试 ${retries} 次` +
    `${models.length > 0 ? ` / 已尝试模型 [${models.join(",")}]` : ""}。` +
    `${savedText}恢复：\`qling --resume ${sessionId}\`（或 \`!load ${sessionId}\` / \`/resume ${sessionId}\`）后发送"继续"。`;
  if (kind === "context_length") text += " 上下文过长，请先执行 /compact 再继续。";
  else if (kind === "auth") text += " 认证失败，不会自动重试或切换模型。";
  else if (kind === "content_policy") text += " 内容策略拒绝，不会自动重试。";
  else if (kind === "bad_request") text += " 请求被拒绝，不会自动重试。";
  return text;
}

export function abortableSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(canceledRequestError());
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(canceledRequestError());
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

function retryLimitFor(kind: ModelErrorKind, maxRetries: number): number {
  return kind === "rate_limited" ? Math.min(maxRetries, 4) : maxRetries;
}

function raiseModelRetry(error: ModelRetryError): never {
  throw error;
}

export async function callModelWithRetry<T>(options: CallModelWithRetryOptions<T>): Promise<T> {
  const policy = options.policy;
  const maxRetries = options.retryCap === undefined
    ? policy.maxRetries
    : Math.min(policy.maxRetries, Math.max(0, Math.trunc(options.retryCap)));
  const allowFallback = options.allowFallback !== false;
  const models = (allowFallback ? options.models : options.models.slice(0, 1))
    .map((model) => model.trim())
    .filter(Boolean)
    .slice(0, 4);
  const now = options.now ?? Date.now;
  const rng = options.rng ?? Math.random;
  const sleep = options.sleep ?? abortableSleep;
  const started = now();
  let totalCalls = 0;
  let retries = 0;
  let lastClassification: ModelErrorClassification = { kind: "network", retryable: true };
  const modelsTried: string[] = [];

  const elapsed = () => Math.max(0, now() - started);
  const terminalError = (): ModelRetryError => {
    const kind = lastClassification.kind;
    options.onEvent?.({
      type: "model_retry_exhausted",
      attempts: totalCalls,
      elapsedMs: elapsed(),
      lastKind: kind,
      models: [...modelsTried],
      model: modelsTried.at(-1),
      status: lastClassification.status,
      requestId: lastClassification.requestId,
    });
    return new ModelRetryError({
      message: `model call failed: ${kind}`,
      attempts: totalCalls,
      retries,
      lastKind: kind,
      modelsTried: [...modelsTried],
      status: lastClassification.status,
      code: lastClassification.code ?? kind,
      requestId: lastClassification.requestId,
      retriable: RETRYABLE_KINDS.has(kind),
      retryAfterMs: lastClassification.retryAfterMs,
    });
  };

  if (models.length === 0) {
    lastClassification = { kind: "bad_request", retryable: false, code: "bad_request" };
    throw terminalError();
  }

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const model = models[modelIndex]!;
    modelsTried.push(model);
    let modelRetries = 0;
    let rateRetries = 0;

    for (;;) {
      if (options.signal?.aborted) throw canceledRequestError();
      if (totalCalls > 0 && elapsed() >= policy.maxElapsedMs) throw terminalError();

      totalCalls++;
      try {
        const value = await options.call(model, modelRetries);
        if (retries > 0 || modelIndex > 0) {
          options.onEvent?.({
            type: "model_retry_recovered",
            attempts: totalCalls,
            elapsedMs: elapsed(),
            model,
          });
        }
        return value;
      } catch (error) {
        if (options.signal?.aborted || isCanceledError(error)) {
          throw isCanceledError(error) ? error : canceledRequestError();
        }
        lastClassification = classifyModelError(error);
        if (lastClassification.kind === "canceled") throw canceledRequestError();

        const limit = retryLimitFor(lastClassification.kind, maxRetries);
        const used = lastClassification.kind === "rate_limited" ? rateRetries : modelRetries;
        const backoff = computeBackoffMs(modelRetries + 1, policy, lastClassification.retryAfterMs, rng);
        const budgetLeft = !options.runBudget || options.runBudget.remaining > 0;
        const costOk = !options.costExhausted?.();
        const timeOk = elapsed() < policy.maxElapsedMs;
        const underLimit = modelRetries < maxRetries && used < limit;
        const canRetry = lastClassification.retryable
          && !backoff.retryAfterExhausted
          && underLimit
          && budgetLeft
          && costOk
          && timeOk;
        const canFallback = allowFallback
          && lastClassification.retryable
          && budgetLeft
          && costOk
          && timeOk
          && modelIndex < models.length - 1
          && (backoff.retryAfterExhausted || !underLimit);

        if (!canRetry) {
          if (canFallback) {
            const next = models[modelIndex + 1]!;
            options.onEvent?.({
              type: "model_fallback",
              from: model,
              to: next,
              reason: backoff.retryAfterExhausted ? "retry_after" : lastClassification.kind,
            });
            break;
          }
          throw terminalError();
        }

        if (options.runBudget) options.runBudget.remaining -= 1;
        modelRetries++;
        retries++;
        if (lastClassification.kind === "rate_limited") rateRetries++;
        const remainingTime = Math.max(0, policy.maxElapsedMs - elapsed());
        const delayMs = Math.min(backoff.delayMs, remainingTime);
        options.onEvent?.({
          type: "model_retry",
          attempt: modelRetries,
          max: limit,
          delayMs,
          kind: lastClassification.kind,
          status: lastClassification.status,
          requestId: lastClassification.requestId,
          model,
        });
        try {
          await sleep(delayMs, options.signal);
        } catch (sleepError) {
          if (options.signal?.aborted || isCanceledError(sleepError)) {
            throw isCanceledError(sleepError) ? sleepError : canceledRequestError();
          }
          throw sleepError;
        }
        if (options.signal?.aborted) throw canceledRequestError();
      }
    }
  }

  return raiseModelRetry(terminalError());
}
