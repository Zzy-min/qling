// ============================================================
// 轻灵 - s06 上下文压缩 v2（参考 Microsoft AI Agents for Beginners Lesson 12）
// 三层压缩策略 + 冲突剪枝 + 防毒验证
// ============================================================

import { Message } from "./types.js";

// --- Token 估算（中文字符 ≈ 2 tokens，英文 ≈ 0.25 tokens）---

function estimateTokens(text: string): number {
  let count = 0;
  for (const ch of text) {
    // CJK \u5b57\u7b26\u7ea6 1.5 tokens\uff0cASCII \u7ea6 0.25 tokens
    count += ch >= "\u4e00" && ch <= "\u9fff" ? 1.5 : 0.25;
  }
  return count;
}

function estimateMessageTokens(msg: Message): number {
  let count = estimateTokens(msg.content);
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      count += estimateTokens(JSON.stringify(tc));
    }
  }
  return count;
}

// --- 冲突检测模式（Lesson 12: Context Pruning）---

const CONFLICTING_PATTERNS = [
  // 同一文件不同路径的互相覆盖指令
  [/目标文件.*和.*文件.*冲突/, /互相覆盖/],
  // 先说"不要"再说"一定要"
  [/不要(做|使用|调用)/, /(一定|必须|只能)(做|使用|调用)/],
  // 撤销之前决策
  [/撤销.*决定/, /重新.*决策/],
  // 路径矛盾
  [/使用.*路径[：:]/, /改用.*路径[：:]/],
];

// --- 防毒检测模式（Lesson 12: Context Validation）---

const POISON_PATTERNS = [
  // 提示注入
  /\b(忽略|忘记|disregard|ignore)\s+(以上|之前|all\s+(previous|above))\s+(指令|指示|instruct)/i,
  // 角色扮演逃逸
  /\b(你是|you\s+are)\s+.*\s+(现在|now)\s+(可以|can)\s+(做任何|do\s+anything)/i,
  // 越狱提示
  /\b(DAN|jailbreak|越狱)/i,
  // 隐藏指令
  /\b\[系统\]|\[内部\]|\[隐藏\]/i,
  // 编码混淆
  /base64\s*[:=]|\\x[0-9a-f]{2}|&#x/i,
];

interface ConflictPair {
  msgA: number; // index in messages
  msgB: number;
  reason: string;
}

// --- 冲突检测 ---
function detectConflicts(messages: Message[]): ConflictPair[] {
  const conflicts: ConflictPair[] = [];
  for (let i = 0; i < messages.length; i++) {
    for (let j = i + 1; j < messages.length; j++) {
      const a = messages[i].content;
      const b = messages[j].content;
      for (const [patA, patB] of CONFLICTING_PATTERNS) {
        if (patA.test(a) && patB.test(b)) {
          conflicts.push({
            msgA: i,
            msgB: j,
            reason: `模式冲突: ${patA} vs ${patB}`,
          });
        }
      }
    }
  }
  return conflicts;
}

// --- 防毒检测 ---
function detectPoison(message: Message): string[] {
  const findings: string[] = [];
  for (const pattern of POISON_PATTERNS) {
    if (pattern.test(message.content)) {
      findings.push(String(pattern));
    }
  }
  return findings;
}

function findLinkedAssistantIndex(messages: Message[], toolAbsIdx: number): number {
  const toolMsg = messages[toolAbsIdx];
  if (!toolMsg || toolMsg.role !== "tool") return -1;
  const toolCallId = toolMsg.tool_call_id;

  for (let i = toolAbsIdx - 1; i >= 0; i--) {
    const candidate = messages[i];
    if (!candidate || candidate.role !== "assistant") continue;
    if ((candidate.tool_calls?.length ?? 0) === 0) continue;
    if (!toolCallId) return i;
    if (candidate.tool_calls!.some((tc) => tc.id === toolCallId)) {
      return i;
    }
  }

  return -1;
}

// --- 摘要 prompt ---
const SUMMARY_PROMPT = `请将以下会话历史压缩为简洁摘要，保留：
1. 已完成的关键任务和结果
2. 重要的文件路径、配置、决策
3. 未完成的任务和当前进度
4. 任何冲突的指令（如果存在）
用中文回复，直接输出摘要，不需要解释。`;

export class ContextCompactor {
  private maxTokens: number;
  private model: string;

  constructor(maxTokens = 6000, model = "deepseek-chat") {
    this.maxTokens = maxTokens;
    this.model = model;
  }

  // 检查是否需要压缩
  needsCompaction(messages: Message[]): boolean {
    const total = messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
    return total > this.maxTokens;
  }

  // 执行压缩：摘要旧消息 + 保留 recent
  async compact(messages: Message[], recentKeep = 6): Promise<Message[]> {
    if (messages.length <= recentKeep + 1) return messages;

    // recent 必须包含完整的 tool_call chain（最近的 assistant 的 tool_calls + 对应 tool 结果）
    // 保护机制：若 recentKeep 内有 tool 消息对，往外扩直到找到对应的 assistant message
    let recentMsgs = messages.slice(-recentKeep);
    const recentStartIdx = messages.length - recentMsgs.length;

    // 检查 recent 中是否有 tool 消息但缺少对应的 assistant（tool_calls）
    let protectedStartIdx = recentStartIdx;
    for (let i = 0; i < recentMsgs.length; i++) {
      const msg = recentMsgs[i];
      if (msg.role === "tool") {
        const toolAbsIdx = recentStartIdx + i;
        const assistantIdx = findLinkedAssistantIndex(messages, toolAbsIdx);
        const chainStartIdx = assistantIdx >= 0 ? assistantIdx : toolAbsIdx;
        if (chainStartIdx < protectedStartIdx) {
          protectedStartIdx = chainStartIdx;
        }
      }
    }

    if (protectedStartIdx < recentStartIdx) {
      recentMsgs = messages.slice(protectedStartIdx);
      console.error(`📦 保护 tool chain，向外扩展 recent 到 ${messages.length - protectedStartIdx} 条`);
    }

    // oldMsgs = recent 之前的所有消息（不含 system，因为 AgentLoop.messages 不含 system）
    const oldMsgs = messages.slice(0, messages.length - recentMsgs.length);

    // 1. 冲突检测（Lesson 12: Context Pruning）
    const conflicts = detectConflicts(messages);
    if (conflicts.length > 0) {
      console.error(`⚠️ 检测到 ${conflicts.length} 处指令冲突`);
    }

    // 2. 防毒扫描（Lesson 12: Context Validation）
    const poisonFindings: { index: number; patterns: string[] }[] = [];
    for (let i = 0; i < oldMsgs.length; i++) {
      const findings = detectPoison(oldMsgs[i]);
      if (findings.length > 0) {
        poisonFindings.push({ index: i, patterns: findings });
      }
    }
    let cleanedOldMsgs = oldMsgs;
    if (poisonFindings.length > 0) {
      console.error(`🚨 检测到 ${poisonFindings.length} 处可能的提示注入`);
      // 过滤掉有毒消息
      const cleanOld = oldMsgs.filter((_, i) => {
        return !poisonFindings.some((p) => p.index === i);
      });
      if (cleanOld.length >= 1) {
        cleanedOldMsgs = cleanOld;
      }
    }

    // 3. 摘要旧消息
    const oldText = cleanedOldMsgs
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");

    const summary = await this.summarize(oldText);

    // 4. 构建冲突警告（如果有）
    let conflictNote = "";
    if (conflicts.length > 0) {
      conflictNote = conflicts
        .map(
          (c) =>
            `- 第${c.msgA}条与第${c.msgB}条冲突: ${c.reason}`
        )
        .join("\n");
    }

    // 用 user 消息注入摘要（AgentLoop.messages 不含 system role）
    const result: Message[] = [];

    if (summary || conflictNote) {
      result.push({
        role: "user",
        content:
          `【会话记忆摘要（压缩后）】\n${summary}${
            conflictNote ? `\n\n⚠️ 冲突警告：\n${conflictNote}` : ""
          }`,
      });
    }

    result.push(...recentMsgs);
    return result;
  }

  // 精简超长工具结果
  trimToolResult(msg: Message): Message {
    if (msg.role !== "tool") return msg;
    const MAX_TOOL_OUTPUT = 800;
    if (msg.content.length <= MAX_TOOL_OUTPUT) return msg;

    const trimmed =
      msg.content.slice(0, MAX_TOOL_OUTPUT) + "\n...（已截断）";
    return { ...msg, content: trimmed };
  }

  // 扫描上下文中的冲突（供 AgentLoop 主动警告）
  scanConflicts(messages: Message[]): ConflictPair[] {
    return detectConflicts(messages);
  }

  // 扫描上下文中的注入（供 AgentLoop 主动警告）
  scanPoison(messages: Message[]): { index: number; patterns: string[] }[] {
    const findings: { index: number; patterns: string[] }[] = [];
    for (let i = 0; i < messages.length; i++) {
      const patterns = detectPoison(messages[i]);
      if (patterns.length > 0) {
        findings.push({ index: i, patterns });
      }
    }
    return findings;
  }

  // 调用 DeepSeek 摘要
  private async summarize(text: string): Promise<string> {
    if (!text.trim()) return "";
    try {
      const { default: axios } = await import("axios");
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) return "[无 API Key，无法摘要]";

      const resp = await axios.post(
        "https://api.deepseek.com/chat/completions",
        {
          model: this.model,
          messages: [
            { role: "system", content: SUMMARY_PROMPT },
            { role: "user", content: text.slice(0, 4000) },
          ],
          max_tokens: 500,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 30_000,
        }
      );

      return (
        resp.data.choices?.[0]?.message?.content?.toString().trim() ??
        "[摘要生成失败]"
      );
    } catch {
      return `[摘要失败: ${text.slice(0, 200)}...]`;
    }
  }
}
