// ============================================================
// Phase 3.0 — 工具结果上下文卫生
// 默认折叠超长 tool output，保留头尾 + 元数据，避免每轮 payload 膨胀。
// QLING_TOOL_RESULT_MAX_CHARS: 默认 6000；0 = 不截断
// ============================================================

export interface ToolOutputSummaryOptions {
  /** 超过此字符数则折叠。0 或负数 = 不截断。 */
  maxChars?: number;
  headChars?: number;
  tailChars?: number;
}

export interface ContextLayerEstimate {
  historyChars: number;
  toolOutputChars: number;
  otherChars: number;
  totalChars: number;
  historyPct: number;
  toolOutputPct: number;
  otherPct: number;
  messageCount: number;
  toolMessageCount: number;
  /** G2.5 分类占用（对标 Grok /context breakdown） */
  systemChars: number;
  messagesChars: number;
  toolsChars: number;
  freeChars: number;
  budgetChars: number;
  systemPct: number;
  messagesPct: number;
  toolsPct: number;
  freePct: number;
  userMessageCount: number;
  assistantMessageCount: number;
}

const DEFAULT_MAX = 6000;
const DEFAULT_HEAD = 2400;
const DEFAULT_TAIL = 1200;

export function resolveToolResultMaxChars(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): number {
  const raw = env.QLING_TOOL_RESULT_MAX_CHARS;
  if (raw === undefined || raw === "") return DEFAULT_MAX;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MAX;
  if (n <= 0) return 0;
  return Math.floor(n);
}

/**
 * 折叠超长纯文本工具输出。短文本原样返回。
 */
export function summarizeToolOutputForContext(
  output: string,
  options: ToolOutputSummaryOptions = {}
): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX;
  if (maxChars <= 0) return output;
  if (output.length <= maxChars) return output;

  const lines = output.split("\n").length;
  const requestedHead = Math.max(0, options.headChars ?? DEFAULT_HEAD);
  const requestedTail = Math.max(0, options.tailChars ?? DEFAULT_TAIL);
  const markerFor = (omitted: number) =>
    `\n…[已截断: 共 ${output.length} 字符 / ${lines} 行，省略约 ${Math.max(0, omitted)} 字符；` +
    `需要全文请用 read/search 定位，或调高 QLING_TOOL_RESULT_MAX_CHARS]…\n`;

  let marker = markerFor(output.length);
  if (marker.length >= maxChars) {
    return `…[已截断 ${output.length} 字符]…`.slice(0, maxChars);
  }

  const requestedTotal = requestedHead + requestedTail;
  const bodyBudget = maxChars - marker.length;
  let headChars =
    requestedTotal > 0
      ? Math.min(requestedHead, Math.ceil((bodyBudget * requestedHead) / requestedTotal))
      : Math.ceil(bodyBudget / 2);
  let tailChars = Math.min(requestedTail, bodyBudget - headChars);
  if (requestedTotal === 0) tailChars = bodyBudget - headChars;

  marker = markerFor(output.length - headChars - tailChars);
  const overflow = headChars + marker.length + tailChars - maxChars;
  if (overflow > 0) {
    const trimTail = Math.min(tailChars, overflow);
    tailChars -= trimTail;
    headChars = Math.max(0, headChars - (overflow - trimTail));
  }

  return output.slice(0, headChars) + marker + output.slice(-tailChars || output.length);
}

/**
 * 将 tool 消息 content（可能是 JSON.stringify(result)）做卫生处理。
 * 保持 is_error / tool_call_id 等结构字段。
 */
export function prepareToolResultContent(
  content: string,
  options: ToolOutputSummaryOptions = {}
): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX;
  if (maxChars <= 0) return content;

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && typeof parsed.output === "string") {
      const next = {
        ...parsed,
        output: summarizeToolOutputForContext(parsed.output, options),
      };
      return JSON.stringify(next);
    }
  } catch {
    // plain text tool content
  }
  return summarizeToolOutputForContext(content, options);
}

function messageChars(msg: { role?: string; content?: string; tool_calls?: unknown }): number {
  let n = typeof msg.content === "string" ? msg.content.length : 0;
  if (msg.tool_calls) {
    try {
      n += JSON.stringify(msg.tool_calls).length;
    } catch {
      // ignore
    }
  }
  return n;
}

/**
 * 上下文字符预算（本地估计，非 provider token）。
 * QLING_CONTEXT_CHAR_BUDGET 可覆盖；默认约 4 万字符量级。
 */
export function resolveContextCharBudget(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): number {
  const raw = env.QLING_CONTEXT_CHAR_BUDGET;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 40_000;
}

/**
 * 本地字符层估计（非 provider token）。用于 /context harness 可见性。
 */
export function estimateContextLayers(
  messages: Array<{ role?: string; content?: string; tool_calls?: unknown }>,
  options: {
    systemPrompt?: string;
    budgetChars?: number;
  } = {}
): ContextLayerEstimate {
  let historyChars = 0;
  let toolOutputChars = 0;
  let otherChars = 0;
  let toolMessageCount = 0;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let systemFromMessages = 0;

  for (const msg of messages) {
    const c = messageChars(msg);
    const role = msg.role ?? "";
    if (role === "tool") {
      toolOutputChars += c;
      toolMessageCount++;
    } else if (role === "user" || role === "assistant") {
      historyChars += c;
      if (role === "user") userMessageCount++;
      else assistantMessageCount++;
    } else if (role === "system") {
      systemFromMessages += c;
      otherChars += c;
    } else {
      otherChars += c;
    }
  }

  const systemChars =
    (typeof options.systemPrompt === "string" ? options.systemPrompt.length : 0) +
    systemFromMessages;
  const messagesChars = historyChars;
  const toolsChars = toolOutputChars;
  const usedWithoutFree = systemChars + messagesChars + toolsChars + Math.max(0, otherChars - systemFromMessages);
  const budgetChars = Math.max(
    usedWithoutFree,
    options.budgetChars ?? resolveContextCharBudget()
  );
  const freeChars = Math.max(0, budgetChars - usedWithoutFree);

  const totalChars = historyChars + toolOutputChars + otherChars || 1;
  const pct = (n: number, base = totalChars) =>
    Math.round((n / Math.max(1, base)) * 1000) / 10;
  const budgetPct = (n: number) => pct(n, budgetChars);

  return {
    historyChars,
    toolOutputChars,
    otherChars,
    totalChars: historyChars + toolOutputChars + otherChars,
    historyPct: pct(historyChars),
    toolOutputPct: pct(toolOutputChars),
    otherPct: pct(otherChars),
    messageCount: messages.length,
    toolMessageCount,
    systemChars,
    messagesChars,
    toolsChars,
    freeChars,
    budgetChars,
    systemPct: budgetPct(systemChars),
    messagesPct: budgetPct(messagesChars),
    toolsPct: budgetPct(toolsChars),
    freePct: budgetPct(freeChars),
    userMessageCount,
    assistantMessageCount,
  };
}
