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

/**
 * 从消息列表推导会话展示名：第一条非噪声 user 文本。
 * 找不到则返回空串（调用方回退到 sessionId/name）。
 */
export function deriveSessionTitle(
  messages: Array<{ role?: string; content?: unknown }>,
  maxLen = 40
): string {
  for (const message of messages) {
    if (message?.role !== "user") continue;
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
