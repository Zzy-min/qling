// ============================================================
// Phase 3.5 — Mission 进度通知（Telegram / Slack 结构化卡片）
// QLING_MISSION_NOTIFY=on|off（默认 on：有 token 才发）
// QLING_MISSION_NOTIFY_STYLE=plain|rich（默认 rich）
// ============================================================

import axios from "axios";
import type { Mission, MissionStatus } from "./types.js";

export type MissionNotifyEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function isMissionNotifyEnabled(env: MissionNotifyEnv = process.env): boolean {
  const raw = String(env.QLING_MISSION_NOTIFY ?? "on").trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false") return false;
  return true;
}

export function resolveNotifyStyle(
  env: MissionNotifyEnv = process.env
): "plain" | "rich" {
  const raw = String(env.QLING_MISSION_NOTIFY_STYLE ?? "rich").trim().toLowerCase();
  return raw === "plain" || raw === "text" ? "plain" : "rich";
}

/** 使命日志推送策略：off | milestone（默认）| all */
export type MissionLogNotifyMode = "off" | "milestone" | "all";

export function resolveMissionLogNotifyMode(
  env: MissionNotifyEnv = process.env
): MissionLogNotifyMode {
  const raw = String(env.QLING_MISSION_NOTIFY_LOGS ?? "milestone").trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false" || raw === "none") return "off";
  if (raw === "all" || raw === "on" || raw === "1" || raw === "true") return "all";
  return "milestone";
}

const MILESTONE_LOG_RE =
  /使命(开始|执行成功|执行失败|未启动)|开始执行|执行成功|执行失败|恢复状态机|checkpoint|失败|succeeded|failed|canceled|paused|blocked/i;

/**
 * 是否应对本条使命日志发通道通知。
 */
export function shouldNotifyMissionLog(
  message: string,
  env: MissionNotifyEnv = process.env
): boolean {
  if (!isMissionNotifyEnabled(env)) return false;
  const mode = resolveMissionLogNotifyMode(env);
  if (mode === "off") return false;
  if (mode === "all") return true;
  return MILESTONE_LOG_RE.test(String(message ?? ""));
}

export function formatMissionLogMessage(
  mission: Pick<Mission, "id" | "name" | "status">,
  message: string
): string {
  const msg = String(message ?? "").replace(/\s+/g, " ").slice(0, 240);
  return [
    `📝 【轻灵使命日志】`,
    `id: ${mission.id}`,
    `name: ${mission.name}`,
    `status: ${mission.status}`,
    `log: ${msg}`,
  ].join("\n");
}

const STATUS_EMOJI: Record<MissionStatus, string> = {
  queued: "⏳",
  running: "🚀",
  blocked: "🛑",
  paused: "⏸️",
  exhausted: "⚠️",
  succeeded: "✅",
  failed: "❌",
  canceled: "🚫",
};

export function statusEmoji(status: MissionStatus): string {
  return STATUS_EMOJI[status] ?? "📡";
}

export function formatMissionProgressMessage(
  mission: Pick<Mission, "id" | "name" | "description" | "status" | "error">,
  from: MissionStatus | null,
  to: MissionStatus
): string {
  const arrow = from ? `${from} → ${to}` : `→ ${to}`;
  const desc = (mission.description || "").replace(/\s+/g, " ").slice(0, 120);
  const err =
    to === "failed" && mission.error?.message
      ? `\n错误: ${mission.error.message.slice(0, 200)}`
      : "";
  return [
    `${statusEmoji(to)} 【轻灵使命进度】`,
    `id: ${mission.id}`,
    `name: ${mission.name}`,
    `status: ${arrow}`,
    desc ? `task: ${desc}` : null,
    err || null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Telegram HTML（需 escape） */
export function formatMissionProgressTelegramHtml(
  mission: Pick<Mission, "id" | "name" | "description" | "status" | "error">,
  from: MissionStatus | null,
  to: MissionStatus
): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const arrow = from ? `${esc(from)} → <b>${esc(to)}</b>` : `→ <b>${esc(to)}</b>`;
  const desc = (mission.description || "").replace(/\s+/g, " ").slice(0, 120);
  const lines = [
    `${statusEmoji(to)} <b>轻灵使命进度</b>`,
    `<code>${esc(mission.id)}</code>`,
    `名称: ${esc(mission.name || "-")}`,
    `状态: ${arrow}`,
  ];
  if (desc) lines.push(`任务: ${esc(desc)}`);
  if (to === "failed" && mission.error?.message) {
    lines.push(`错误: <i>${esc(mission.error.message.slice(0, 200))}</i>`);
  }
  return lines.join("\n");
}

/** Slack Block Kit 最小卡片 */
export function formatMissionProgressSlackBlocks(
  mission: Pick<Mission, "id" | "name" | "description" | "status" | "error">,
  from: MissionStatus | null,
  to: MissionStatus
): { text: string; blocks: unknown[] } {
  const plain = formatMissionProgressMessage(mission, from, to);
  const arrow = from ? `${from} → *${to}*` : `→ *${to}*`;
  const desc = (mission.description || "").replace(/\s+/g, " ").slice(0, 120);
  const fields = [
    { type: "mrkdwn", text: `*ID*\n\`${mission.id}\`` },
    { type: "mrkdwn", text: `*状态*\n${arrow}` },
    { type: "mrkdwn", text: `*名称*\n${mission.name || "-"}` },
  ];
  if (desc) {
    fields.push({ type: "mrkdwn", text: `*任务*\n${desc}` });
  }

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${statusEmoji(to)} 轻灵使命进度`,
        emoji: true,
      },
    },
    { type: "section", fields },
  ];

  if (to === "failed" && mission.error?.message) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*错误*\n${mission.error.message.slice(0, 200)}`,
      },
    });
  }

  blocks.push({ type: "divider" });
  return { text: plain, blocks };
}

function parseJsonStringArray(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    return raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export interface NotifyDispatchResult {
  attempted: boolean;
  telegram: "sent" | "skipped" | "error";
  slack: "sent" | "skipped" | "error";
  detail: string;
  style: "plain" | "rich";
}

export function assertSlackResponseOk(data: unknown): void {
  if (!data || typeof data !== "object") return;
  const body = data as { ok?: unknown; error?: unknown };
  if (body.ok === false) {
    const code = String(body.error ?? "unknown_error")
      .replace(/[^a-zA-Z0-9_.-]/g, "_")
      .slice(0, 120);
    throw new Error(`Slack API error: ${code}`);
  }
}

/**
 * 向已配置的 Telegram / Slack 发送使命进度（失败不抛出）。
 */
export async function notifyMissionProgress(
  mission: Mission,
  from: MissionStatus | null,
  to: MissionStatus,
  env: MissionNotifyEnv = process.env
): Promise<NotifyDispatchResult> {
  const style = resolveNotifyStyle(env);

  if (!isMissionNotifyEnabled(env)) {
    return {
      attempted: false,
      telegram: "skipped",
      slack: "skipped",
      detail: "QLING_MISSION_NOTIFY off",
      style,
    };
  }

  const notable = new Set<MissionStatus>([
    "running",
    "blocked",
    "paused",
    "succeeded",
    "failed",
    "canceled",
  ]);
  if (!notable.has(to)) {
    return {
      attempted: false,
      telegram: "skipped",
      slack: "skipped",
      detail: `status ${to} not notable`,
      style,
    };
  }

  const plain = formatMissionProgressMessage(mission, from, to);
  let telegram: NotifyDispatchResult["telegram"] = "skipped";
  let slack: NotifyDispatchResult["slack"] = "skipped";
  const details: string[] = [];

  const tgToken = String(env.QLING_CHANNEL_TELEGRAM_TOKEN ?? "").trim();
  const tgChats = parseJsonStringArray(
    env.QLING_CHANNEL_TELEGRAM_ALLOWED_CHAT_IDS as string | undefined
  );
  const tgProgress = String(env.QLING_MISSION_TELEGRAM_CHAT_ID ?? "").trim();
  const chatIds = tgProgress ? [tgProgress, ...tgChats] : tgChats;

  if (tgToken && chatIds.length > 0) {
    try {
      for (const chatId of [...new Set(chatIds)]) {
        if (style === "rich") {
          const html = formatMissionProgressTelegramHtml(mission, from, to);
          await axios.post(
            `https://api.telegram.org/bot${tgToken}/sendMessage`,
            {
              chat_id: chatId,
              text: html.length > 3900 ? html.slice(0, 3900) + "…" : html,
              parse_mode: "HTML",
              disable_web_page_preview: true,
            },
            { timeout: 10_000 }
          );
        } else {
          const body = plain.length > 3900 ? plain.slice(0, 3900) + "\n…" : plain;
          await axios.post(
            `https://api.telegram.org/bot${tgToken}/sendMessage`,
            { chat_id: chatId, text: body },
            { timeout: 10_000 }
          );
        }
      }
      telegram = "sent";
      details.push(`telegram chats=${chatIds.length} style=${style}`);
    } catch (err) {
      telegram = "error";
      details.push(`telegram: ${(err as Error).message}`);
    }
  }

  const slackToken = String(env.QLING_CHANNEL_SLACK_BOT_TOKEN ?? "").trim();
  let slackChannels = parseJsonStringArray(
    env.QLING_CHANNEL_SLACK_CHANNEL_IDS as string | undefined
  );
  const slackProgress = String(env.QLING_MISSION_SLACK_CHANNEL_ID ?? "").trim();
  if (slackProgress) slackChannels = [slackProgress, ...slackChannels];

  if (slackToken && slackChannels.length > 0) {
    try {
      const card =
        style === "rich"
          ? formatMissionProgressSlackBlocks(mission, from, to)
          : { text: plain, blocks: undefined as unknown[] | undefined };
      for (const channel of [...new Set(slackChannels)]) {
        const payload: Record<string, unknown> = {
          channel,
          text: card.text.length > 2900 ? card.text.slice(0, 2900) + "\n…" : card.text,
        };
        if (style === "rich" && card.blocks) {
          payload.blocks = card.blocks;
        }
        const response = await axios.post("https://slack.com/api/chat.postMessage", payload, {
          timeout: 10_000,
          headers: {
            Authorization: `Bearer ${slackToken}`,
            "Content-Type": "application/json; charset=utf-8",
          },
        });
        assertSlackResponseOk(response.data);
      }
      slack = "sent";
      details.push(`slack channels=${slackChannels.length} style=${style}`);
    } catch (err) {
      slack = "error";
      details.push(`slack: ${(err as Error).message}`);
    }
  }

  const attempted =
    telegram === "sent" || slack === "sent" || telegram === "error" || slack === "error";
  return {
    attempted,
    telegram,
    slack,
    detail: details.join("; ") || "no channel targets configured",
    style,
  };
}

/**
 * 使命日志推送（默认仅里程碑；失败不抛出）。
 * QLING_MISSION_NOTIFY_LOGS=off|milestone|all
 */
export async function notifyMissionLog(
  mission: Mission,
  message: string,
  env: MissionNotifyEnv = process.env
): Promise<NotifyDispatchResult> {
  const style = resolveNotifyStyle(env);
  if (!shouldNotifyMissionLog(message, env)) {
    return {
      attempted: false,
      telegram: "skipped",
      slack: "skipped",
      detail: "log not notifiable",
      style,
    };
  }

  const plain = formatMissionLogMessage(mission, message);
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = [
    `📝 <b>轻灵使命日志</b>`,
    `<code>${esc(mission.id)}</code>`,
    `名称: ${esc(mission.name || "-")}`,
    `状态: ${esc(mission.status)}`,
    `日志: ${esc(String(message).slice(0, 240))}`,
  ].join("\n");

  let telegram: NotifyDispatchResult["telegram"] = "skipped";
  let slack: NotifyDispatchResult["slack"] = "skipped";
  const details: string[] = [];

  const tgToken = String(env.QLING_CHANNEL_TELEGRAM_TOKEN ?? "").trim();
  const tgChats = parseJsonStringArray(
    env.QLING_CHANNEL_TELEGRAM_ALLOWED_CHAT_IDS as string | undefined
  );
  const tgProgress = String(env.QLING_MISSION_TELEGRAM_CHAT_ID ?? "").trim();
  const chatIds = tgProgress ? [tgProgress, ...tgChats] : tgChats;

  if (tgToken && chatIds.length > 0) {
    try {
      for (const chatId of [...new Set(chatIds)]) {
        const payload: Record<string, unknown> = {
          chat_id: chatId,
          text:
            style === "rich"
              ? html.length > 3900
                ? html.slice(0, 3900) + "…"
                : html
              : plain.length > 3900
                ? plain.slice(0, 3900) + "\n…"
                : plain,
        };
        if (style === "rich") {
          payload.parse_mode = "HTML";
          payload.disable_web_page_preview = true;
        }
        await axios.post(`https://api.telegram.org/bot${tgToken}/sendMessage`, payload, {
          timeout: 10_000,
        });
      }
      telegram = "sent";
      details.push("telegram log");
    } catch (err) {
      telegram = "error";
      details.push(`telegram: ${(err as Error).message}`);
    }
  }

  const slackToken = String(env.QLING_CHANNEL_SLACK_BOT_TOKEN ?? "").trim();
  let slackChannels = parseJsonStringArray(
    env.QLING_CHANNEL_SLACK_CHANNEL_IDS as string | undefined
  );
  const slackProgress = String(env.QLING_MISSION_SLACK_CHANNEL_ID ?? "").trim();
  if (slackProgress) slackChannels = [slackProgress, ...slackChannels];

  if (slackToken && slackChannels.length > 0) {
    try {
      for (const channel of [...new Set(slackChannels)]) {
        const payload: Record<string, unknown> = {
          channel,
          text: plain.length > 2900 ? plain.slice(0, 2900) + "\n…" : plain,
        };
        if (style === "rich") {
          payload.blocks = [
            {
              type: "header",
              text: { type: "plain_text", text: "📝 轻灵使命日志", emoji: true },
            },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", text: `*ID*\n\`${mission.id}\`` },
                { type: "mrkdwn", text: `*状态*\n${mission.status}` },
              ],
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*日志*\n${String(message).replace(/\s+/g, " ").slice(0, 240)}`,
              },
            },
          ];
        }
        const response = await axios.post("https://slack.com/api/chat.postMessage", payload, {
          timeout: 10_000,
          headers: {
            Authorization: `Bearer ${slackToken}`,
            "Content-Type": "application/json; charset=utf-8",
          },
        });
        assertSlackResponseOk(response.data);
      }
      slack = "sent";
      details.push("slack log");
    } catch (err) {
      slack = "error";
      details.push(`slack: ${(err as Error).message}`);
    }
  }

  const attempted =
    telegram === "sent" || slack === "sent" || telegram === "error" || slack === "error";
  return {
    attempted,
    telegram,
    slack,
    detail: details.join("; ") || "no channel targets configured",
    style,
  };
}
