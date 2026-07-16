// ============================================================
// 轻灵 - s06 上下文压缩 v2（参考 Microsoft AI Agents for Beginners Lesson 12）
// 三层压缩策略 + 冲突剪枝 + 防毒验证
// ============================================================

import { Message } from "./types.js";
import * as path from "path";

export type ContextSummaryCallback = (input: {
  systemPrompt: string;
  text: string;
  maxTokens: number;
}) => Promise<string>;

export interface CompactResult {
  messages: Message[];
  status: "compacted" | "skipped" | "failed";
  reason?: string;
}

// --- Token 估算（中文字符 ≈ 2 tokens，英文 ≈ 0.25 tokens）---

function estimateTokens(text: string): number {
  let count = 0;
  for (const ch of text) {
    // CJK 字符约 1.5 tokens，ASCII 约 0.25 tokens
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
  private summarizer?: ContextSummaryCallback;
  private minSummaryChars: number;
  private maxSummaryAttempts: number;

  constructor(
    maxTokens = 6000,
    model = "deepseek-chat",
    options: {
      summarizer?: ContextSummaryCallback;
      minSummaryChars?: number;
      maxSummaryAttempts?: number;
    } = {}
  ) {
    this.maxTokens = maxTokens;
    this.model = model;
    this.summarizer = options.summarizer;
    this.minSummaryChars = Math.max(20, options.minSummaryChars ?? 500);
    this.maxSummaryAttempts = Math.max(1, Math.min(3, options.maxSummaryAttempts ?? 3));
  }

  setSummarizer(summarizer: ContextSummaryCallback): void {
    this.summarizer = summarizer;
  }

  // 检查是否需要压缩
  needsCompaction(messages: Message[]): boolean {
    const total = messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
    return total > this.maxTokens;
  }

  // 执行压缩：摘要旧消息 + 保留 recent
  async compact(
    messages: Message[],
    recentKeep = 6,
    options: { theme?: string } = {}
  ): Promise<Message[]> {
    return (await this.compactDetailed(messages, recentKeep, options)).messages;
  }

  async compactDetailed(
    messages: Message[],
    recentKeep = 6,
    options: { theme?: string } = {}
  ): Promise<CompactResult> {
    const modifiedFiles = getModifiedFilesFromHistory(messages);
    const skeletonizedAll = skeletonizeMessages(messages, modifiedFiles);

    if (skeletonizedAll.length <= recentKeep + 1) {
      return { messages: skeletonizedAll, status: "skipped" };
    }

    // recent 必须包含完整的 tool_call chain（最近的 assistant 的 tool_calls + 对应 tool 结果）
    // 保护机制：若 recentKeep 内有 tool 消息对，往外扩直到找到对应的 assistant message
    let recentMsgs = skeletonizedAll.slice(-recentKeep);
    const recentStartIdx = skeletonizedAll.length - recentMsgs.length;

    // 检查 recent 中是否有 tool 消息构建链路完整性
    let protectedStartIdx = recentStartIdx;
    for (let i = 0; i < recentMsgs.length; i++) {
      const msg = recentMsgs[i];
      if (msg.role === "tool") {
        const toolAbsIdx = recentStartIdx + i;
        const assistantIdx = findLinkedAssistantIndex(skeletonizedAll, toolAbsIdx);
        const chainStartIdx = assistantIdx >= 0 ? assistantIdx : toolAbsIdx;
        if (chainStartIdx < protectedStartIdx) {
          protectedStartIdx = chainStartIdx;
        }
      }
    }

    if (protectedStartIdx < recentStartIdx) {
      recentMsgs = skeletonizedAll.slice(protectedStartIdx);
      console.error(`📦 保护 tool chain，向外扩展 recent 到 ${skeletonizedAll.length - protectedStartIdx} 条`);
    }

    // oldMsgs = recent 之前的所有消息（不含 system，因为 AgentLoop.messages 不含 system）
    const oldMsgs = skeletonizedAll.slice(0, skeletonizedAll.length - recentMsgs.length);

    // 1. 冲突检测（Lesson 12: Context Pruning）
    const conflicts = detectConflicts(skeletonizedAll);
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

    // 3. 摘要旧消息（可选主题焦点）
    const oldText = cleanedOldMsgs
      .filter((message) => !message.synthetic_reason)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");

    const theme = options.theme?.trim();
    const summary = await this.summarize(oldText, theme);
    if (!summary.trim() && oldText.trim()) {
      return {
        messages: [...messages],
        status: "failed",
        reason: "summary generation returned no usable content",
      };
    }

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

    if (summary || conflictNote || theme) {
      const themeLine = theme ? `【保留主题】${theme}\n` : "";
      result.push({
        role: "user",
        content:
          `【会话记忆摘要（压缩后）】\n${themeLine}${summary}${
            conflictNote ? `\n\n⚠️ 冲突警告：\n${conflictNote}` : ""
          }`,
        synthetic_reason: "compaction_summary",
        synthetic_key: `compact-${Date.now()}`,
      });
    }

    const deterministic = skeletonizedAll.filter(
      (message) =>
        message.synthetic_reason === "runtime_environment" ||
        message.synthetic_reason === "dynamic_context" ||
        message.synthetic_reason === "state_snapshot"
    );
    for (const message of deterministic) {
      if (
        !result.some(
          (candidate) =>
            candidate.synthetic_reason === message.synthetic_reason &&
            candidate.synthetic_key === message.synthetic_key
        ) &&
        !recentMsgs.includes(message)
      ) {
        result.push({ ...message });
      }
    }

    const lastRealUser = [...skeletonizedAll]
      .reverse()
      .find((message) => message.role === "user" && !message.synthetic_reason);
    if (
      lastRealUser &&
      !recentMsgs.includes(lastRealUser) &&
      !result.some(
        (message) =>
          message.role === "user" &&
          !message.synthetic_reason &&
          message.content === lastRealUser.content
      )
    ) {
      result.push({ ...lastRealUser });
    }

    result.push(...recentMsgs);
    return { messages: result, status: "compacted" };
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

  // 使用当前 provider 的回调；不可用时走确定性本地摘要。
  private async summarize(text: string, theme?: string): Promise<string> {
    if (!text.trim()) return "";
    let system = SUMMARY_PROMPT;
    if (theme?.trim()) {
      system +=
        `\n\n特别要求：优先保留与「${theme.trim()}」相关的事实、结论、路径与未决问题；` +
        `与主题无关的工具流水可更大幅度压缩。`;
    }
    if (this.summarizer) {
      for (let attempt = 0; attempt < this.maxSummaryAttempts; attempt++) {
        const limit = Math.max(1000, Math.floor(12000 / Math.pow(2, attempt)));
        try {
          const summary = (
            await this.summarizer({
              systemPrompt: system,
              text: text.slice(0, limit),
              maxTokens: 700,
            })
          ).trim();
          if (summary.length >= this.minSummaryChars) return summary;
        } catch {
          // Continue through bounded fallback attempts.
        }
      }
    }
    return this.buildLocalFallbackSummary(text, theme);
  }

  private buildLocalFallbackSummary(text: string, theme?: string): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    const head = normalized.slice(0, 1800);
    const tail = normalized.length > 1800 ? normalized.slice(-900) : "";
    return [
      "【确定性本地摘要】",
      theme?.trim() ? `保留主题: ${theme.trim()}` : "",
      `历史开头: ${head}`,
      tail ? `历史结尾: ${tail}` : "",
    ].filter(Boolean).join("\n");
  }
}

export function skeletonizePython(code: string): string {
  const lines = code.split("\n");
  const result: string[] = [];
  let i = 0;
  const n = lines.length;

  while (i < n) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("def ")) {
      result.push(line);
      const indentMatch = line.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : "";

      i++;
      let folded = false;
      while (i < n) {
        const subLine = lines[i];
        if (subLine.trim() === "") {
          i++;
          continue;
        }
        const subIndentMatch = subLine.match(/^(\s*)/);
        const subIndent = subIndentMatch ? subIndentMatch[1].length : 0;
        if (subIndent > indent.length) {
          if (!folded) {
            result.push(indent + "    # ... (remaining body folded)");
            folded = true;
          }
          i++;
        } else {
          break;
        }
      }
      continue;
    }

    result.push(line);
    i++;
  }
  return result.join("\n");
}

export function skeletonizeBraceLanguage(code: string): string {
  let result = "";
  let i = 0;
  const n = code.length;
  let braceDepth = 0;

  while (i < n) {
    if (code.startsWith("//", i)) {
      const nextNewline = code.indexOf("\n", i);
      const end = nextNewline === -1 ? n : nextNewline;
      result += code.slice(i, end);
      i = end;
      continue;
    }
    if (code.startsWith("/*", i)) {
      const end = code.indexOf("*/", i);
      if (end === -1) {
        result += code.slice(i);
        i = n;
      } else {
        result += code.slice(i, end + 2);
        i = end + 2;
      }
      continue;
    }

    const char = code[i];
    if (char === '"' || char === "'" || char === "`") {
      result += char;
      const quote = char;
      i++;
      while (i < n && code[i] !== quote) {
        if (code[i] === "\\" && i + 1 < n) {
          result += code[i] + code[i + 1];
          i += 2;
        } else {
          result += code[i];
          i++;
        }
      }
      if (i < n) {
        result += code[i];
        i++;
      }
      continue;
    }

    if (char === "{") {
      let startIdx = i - 1;
      while (startIdx >= 0 && code[startIdx] !== ";" && code[startIdx] !== "}" && code[startIdx] !== "{") {
        startIdx--;
      }
      const preceding = code.slice(startIdx + 1, i);
      const isContainer = /\b(class|interface|namespace|enum|struct)\b/.test(preceding);

      if (isContainer) {
        result += "{";
        braceDepth++;
        i++;
      } else {
        if (result.endsWith(" ") || result.endsWith("\t")) {
          result += "{\n  // ... (remaining body folded)\n";
        } else {
          result += " {\n  // ... (remaining body folded)\n";
        }
        let depth = 1;
        i++;
        while (i < n && depth > 0) {
          const c = code[i];
          if (c === '"' || c === "'" || c === "`") {
            const q = c;
            i++;
            while (i < n && code[i] !== q) {
              if (code[i] === "\\" && i + 1 < n) i += 2;
              else i++;
            }
            if (i < n) i++;
            continue;
          }
          if (code.startsWith("//", i)) {
            const nextNewline = code.indexOf("\n", i);
            i = nextNewline === -1 ? n : nextNewline;
            continue;
          }
          if (code.startsWith("/*", i)) {
            const end = code.indexOf("*/", i);
            i = end === -1 ? n : end + 2;
            continue;
          }
          if (c === "{") depth++;
          else if (c === "}") depth--;
          i++;
        }
        result += "}";
      }
      continue;
    }

    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      result += "}";
      i++;
      continue;
    }

    result += char;
    i++;
  }
  return result;
}

export function skeletonizeCode(code: string, ext: string): string {
  if (ext === ".py") {
    return skeletonizePython(code);
  } else if ([".ts", ".js", ".tsx", ".jsx", ".go", ".java", ".cpp", ".c", ".h"].includes(ext)) {
    return skeletonizeBraceLanguage(code);
  }
  return code;
}

export function getModifiedFilesFromHistory(messages: Message[]): Set<string> {
  const modified = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.function.name === "write" || tc.function.name === "patch") {
          try {
            const args = typeof tc.function.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;
            if (args && args.path) {
              modified.add(args.path);
            }
          } catch {
            // Ignore
          }
        }
      }
    }
  }
  return modified;
}

export function skeletonizeMessages(messages: Message[], modifiedFiles: Set<string>): Message[] {
  const result: Message[] = [];

  const toolCallMap = new Map<string, { name: string; path: string }>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.id) {
          let filePath = "";
          try {
            const args = typeof tc.function.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;
            if (args && args.path) {
              filePath = args.path;
            }
          } catch {
            // Ignore
          }
          toolCallMap.set(tc.id, { name: tc.function.name, path: filePath });
        }
      }
    }
  }

  for (const msg of messages) {
    if (msg.role === "tool" && msg.tool_call_id) {
      const callInfo = toolCallMap.get(msg.tool_call_id);
      if (callInfo && callInfo.name === "read" && callInfo.path) {
        const isModified = Array.from(modifiedFiles).some(f => {
          const normA = f.replace(/\\/g, "/").toLowerCase();
          const normB = callInfo.path.replace(/\\/g, "/").toLowerCase();
          return normA === normB || normA.endsWith(normB) || normB.endsWith(normA);
        });

        if (!isModified) {
          try {
            const toolResult = JSON.parse(msg.content);
            if (toolResult && !toolResult.is_error && typeof toolResult.output === "string") {
              const ext = path.extname(callInfo.path).toLowerCase();
              const skeletonized = skeletonizeCode(toolResult.output, ext);
              toolResult.output = skeletonized;
              result.push({
                ...msg,
                content: JSON.stringify(toolResult)
              });
              continue;
            }
          } catch {
            // Ignore
          }
        }
      }
    }
    result.push(msg);
  }

  return result;
}
