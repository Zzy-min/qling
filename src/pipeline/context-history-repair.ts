// ============================================================
// 轻灵 - 发送前历史修复（参考 grok-build compaction_utils 的三步语义，
//         按思路用 TypeScript 重写，未拷贝源码）
// 纯函数、幂等：去重 tool 结果 / 剥离孤儿与错位 tool 结果 / 为未应答
// 的 assistant.tool_calls 补合成结果，避免 provider "tool_use_id 不匹配" 400。
//
// 放在 pipeline/（core-services），供同层的 context-compactor 调用。
// 不要把实现留在 src/ 根上：根上未点名的 context-*.ts 会被分层扫描标成
// other，core-services 再 import 它就是禁止的反向边。
// ============================================================

import type { Message } from "../types.js";

export interface HistoryRepairReport {
  /** 同一 tool_call_id 在同一应答段内出现的重复 tool 消息数（保留首个）。 */
  duplicatesRemoved: number;
  /** 被剥离的孤儿/错位 tool 消息的 tool_call_id（缺失时为 "<missing>"）。 */
  strippedToolResultIds: string[];
  /** 为未应答 tool_call 插入的合成结果数。 */
  syntheticResultsInserted: number;
  /** 本次是否产生了任何改动。 */
  changed: boolean;
}

export interface HistoryRepairResult {
  messages: Message[];
  report: HistoryRepairReport;
}

const SYNTHETIC_TOOL_CONTENT = "[工具未返回结果：执行被中断]";

/**
 * 修复发往 provider 之前的消息序列，使其满足 OpenAI 工具协议：
 * - assistant.tool_calls 中的每个 id 都必须紧随其后有且仅有一个 tool 结果；
 * - tool 结果必须紧跟其声明 assistant，形成连续段；
 * - 同一 id 的重复 tool 结果只保留首个。
 *
 * 幂等：对已修复的历史再次调用，report 各字段均为 0 / 空。
 */
export function repairHistory(messages: Message[]): HistoryRepairResult {
  const out: Message[] = [];
  const strippedToolResultIds: string[] = [];
  let duplicatesRemoved = 0;
  let syntheticResultsInserted = 0;

  let i = 0;
  while (i < messages.length) {
    const message = messages[i];

    if (message.role === "assistant") {
      out.push(message);

      const declared = new Set<string>();
      for (const call of message.tool_calls ?? []) {
        if (call?.id) declared.add(call.id);
      }

      const answeredHere = new Set<string>();
      let j = i + 1;
      // 只接受紧随其声明 assistant 的连续 tool 段。
      while (j < messages.length && messages[j]?.role === "tool") {
        const toolMessage = messages[j];
        const toolCallId = toolMessage.tool_call_id;
        if (!toolCallId || !declared.has(toolCallId)) {
          // 应答了非相邻 assistant（错位）或没有对应声明（孤儿）。
          strippedToolResultIds.push(toolCallId ?? "<missing>");
          j++;
          continue;
        }
        if (answeredHere.has(toolCallId)) {
          duplicatesRemoved++;
          j++;
          continue;
        }
        answeredHere.add(toolCallId);
        out.push(toolMessage);
        j++;
      }

      // 未应答的 tool_call：在该连续段末尾补合成结果，保证协议配对完整。
      for (const id of declared) {
        if (answeredHere.has(id)) continue;
        out.push({
          role: "tool",
          tool_call_id: id,
          content: SYNTHETIC_TOOL_CONTENT,
          synthetic_reason: "history_repair",
        });
        syntheticResultsInserted++;
        answeredHere.add(id);
      }

      i = j;
      continue;
    }

    if (message.role === "tool") {
      // 未紧跟任何声明 assistant 的 tool 结果 → 孤儿，剥离。
      strippedToolResultIds.push(message.tool_call_id ?? "<missing>");
      i++;
      continue;
    }

    out.push(message);
    i++;
  }

  return {
    messages: out,
    report: {
      duplicatesRemoved,
      strippedToolResultIds,
      syntheticResultsInserted,
      changed:
        duplicatesRemoved > 0 ||
        strippedToolResultIds.length > 0 ||
        syntheticResultsInserted > 0,
    },
  };
}
