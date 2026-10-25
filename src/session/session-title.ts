// ============================================================
// 会话展示标题：取「第一条真实用户问题」，过滤系统注入噪声
// ============================================================

/** 内部注入 / 预算 nudge / 压缩摘要等，不应作为会话标题或回放中的用户轮次 */
export function isInternalUserNoise(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (/Token\s*预算即将耗尽/i.test(t)) return true;
  if (/请精简回复.*减少工具调用/i.test(t)) return true;
  if (/^⚠️\s*Token/i.test(t)) return true;
  if (/token budget/i.test(t) && /remaining|耗尽|精简/i.test(t)) return true;
  // 上下文压缩后注入的「会话记忆摘要」不是用户真实问题
  if (/会话记忆摘要|压缩后/.test(t) && /关键任务|已完成|摘要/.test(t)) return true;
  if (/^【会话记忆摘要/.test(t)) return true;
  if (/^#{1,6}\s*已完成的关键任务/.test(t)) return true;
  return false;
}

/** 纯 tool_calls 占位助手消息（无正文）——回放时跳过 */
export function isToolOnlyAssistantText(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return true;
  // e.g. "[tool] bash" / "[tool] write, [tool] bash"
  return /^(\[tool\]\s*[\w.-]+\s*,?\s*)+$/i.test(t);
}

/** 运行时注入块。即使旧会话丢掉了 synthetic_reason，也不当作用户原话回放。 */
const INTERNAL_CONTEXT_BLOCK =
  /^<(?:user_info|dynamic_context|project_preflight|mandatory_rules_ref|efficiency_recovery|run_side_effects|verification_audit|state_snapshot)\b/;

export type ReplayTranscriptItem =
  | { role: "user"; text: string }
  | { role: "thinking"; text: string }
  | { role: "result"; text: string };

export function replayMessageText(message: {
  content?: unknown;
  tool_calls?: Array<{ function?: { name?: string } }>;
}): string {
  if (typeof message.content === "string" && message.content.trim()) {
    return message.content;
  }
  if (message.content != null && typeof message.content !== "string") {
    try {
      return JSON.stringify(message.content);
    } catch {
      return String(message.content);
    }
  }
  const tools = message.tool_calls;
  if (Array.isArray(tools) && tools.length > 0) {
    return tools
      .map((tc) => `[tool] ${tc?.function?.name || "call"}`)
      .join(", ");
  }
  return "";
}

/**
 * /resume 可见回放：只要真实用户话、折叠后的工具前思考、以及无工具调用的最终回答。
 * 工作环境、动态上下文、reasoning_content 和工具结果都不进入画面。
 */
export function classifyReplayMessage(message: {
  role?: string;
  content?: unknown;
  tool_calls?: Array<{ function?: { name?: string } }>;
  synthetic_reason?: string;
} | null | undefined): ReplayTranscriptItem | null {
  if (!message || message.synthetic_reason) return null;
  const role = String(message.role || "");
  if (role !== "user" && role !== "assistant") return null;
  const text = replayMessageText(message);
  if (!text.trim()) return null;
  if (role === "user") {
    if (isInternalUserNoise(text) || INTERNAL_CONTEXT_BLOCK.test(text.trim())) return null;
    return { role: "user", text };
  }
  if (isToolOnlyAssistantText(text)) return null;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return { role: "thinking", text };
  }
  return { role: "result", text };
}

/**
 * 从消息列表推导会话展示名：第一条非噪声 user 文本。
 * 找不到则返回空串（调用方回退到 sessionId/name）。
 */
export function deriveSessionTitle(
  messages: Array<{ role?: string; content?: unknown; synthetic_reason?: string }>,
  maxLen = 40
): string {
  for (const message of messages) {
    if (message?.role !== "user") continue;
    if (message.synthetic_reason) continue;
    const raw =
      typeof message.content === "string"
        ? message.content
        : message.content == null
          ? ""
          : (() => {
              try {
                return JSON.stringify(message.content);
              } catch {
                return String(message.content);
              }
            })();
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text || isInternalUserNoise(text)) continue;
    if (text.length <= maxLen) return text;
    return text.slice(0, Math.max(1, maxLen - 1)) + "…";
  }
  return "";
}
