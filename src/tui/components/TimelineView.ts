// ============================================================
// TimelineView - 中央时间线容器
// 负责渲染所有 timeline items (cards)
// ============================================================

import { S } from "../styles/theme.js";
import { renderWelcomeCard } from "./cards/WelcomeCard.js";
import { renderUserMessageCard } from "./cards/UserMessageCard.js";
import { renderAgentThinkingCard } from "./cards/AgentThinkingCard.js";
import { renderPlanCard } from "./cards/PlanCard.js";
import { renderToolCallCard } from "./cards/ToolCallCard.js";
import { renderValidationCard } from "./cards/ValidationCard.js";
import { renderRepairCard } from "./cards/RepairCard.js";
import { renderFinalAnswerCard } from "./cards/FinalAnswerCard.js";
import { TimelineItem, ToolCallRecord, ValidationRecord } from "../models/types.js";

export interface TimelineViewOptions {
  items: TimelineItem[];
  availableWidth: number;
}

export function renderTimelineView(opt: TimelineViewOptions): string[] {
  const { items, availableWidth: W } = opt;

  // 空状态：WelcomeCard
  if (items.length === 0) {
    return renderWelcomeCard({ availableWidth: W });
  }

  const lines: string[] = [];
  for (const item of items) {
    lines.push(...renderTimelineItem(item, W));
  }

  return lines;
}

function renderTimelineItem(item: TimelineItem, W: number): string[] {
  switch (item.type) {
    case "user":
      return renderUserMessageCard({
        content: item.content,
        timestamp: item.timestamp,
        availableWidth: W,
      });

    case "thinking":
      return renderAgentThinkingCard({
        content: item.content,
        state: item.state ?? "thinking",
        timestamp: item.timestamp,
        availableWidth: W,
      });

    case "plan":
      return renderPlanCard({
        plan: item.plan.items.map((p) => ({
          content: p.content,
          status: p.status,
        })),
        timestamp: item.timestamp,
        availableWidth: W,
      });

    case "tool_call":
      return item.calls.map((call) =>
        renderToolCallCard({
          name: call.name,
          arguments: call.arguments,
          output: call.output,
          status: call.status,
          durationMs: call.durationMs,
          errorType: call.errorType,
          expanded: call.expanded,
          timestamp: item.timestamp,
          availableWidth: W,
        })
      ).flat();

    case "validation":
      return renderValidationCard({
        verdict: item.validation.verdict,
        details: item.validation.details,
        steps: item.validation.steps,
        availableWidth: W,
      });

    case "repair":
      return renderRepairCard({
        attempts: item.repairs.map((r) => ({
          description: r.description,
          status: r.status,
        })),
        finalStatus: item.repairs[0]?.status === "success" ? "success" : "fail",
        availableWidth: W,
      });

    case "answer":
      return renderFinalAnswerCard({
        content: item.content,
        availableWidth: W,
      });

    default:
      return [];
  }
}
