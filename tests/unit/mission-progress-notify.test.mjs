import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import {
  formatMissionProgressMessage,
  formatMissionProgressTelegramHtml,
  formatMissionProgressSlackBlocks,
  formatMissionLogMessage,
  isMissionNotifyEnabled,
  notifyMissionProgress,
  resolveNotifyStyle,
  resolveMissionLogNotifyMode,
  shouldNotifyMissionLog,
  statusEmoji,
} from "../../dist/mission/progress-notify.js";

test("isMissionNotifyEnabled defaults on", () => {
  assert.equal(isMissionNotifyEnabled({}), true);
  assert.equal(isMissionNotifyEnabled({ QLING_MISSION_NOTIFY: "off" }), false);
});

test("formatMissionProgressMessage includes status transition", () => {
  const text = formatMissionProgressMessage(
    {
      id: "msn_1",
      name: "demo",
      description: "do something long enough to trim " + "x".repeat(200),
      status: "running",
    },
    "queued",
    "running"
  );
  assert.match(text, /轻灵使命进度/);
  assert.match(text, /msn_1/);
  assert.match(text, /queued → running/);
  assert.ok(text.includes(statusEmoji("running")));
});

test("telegram html escapes and bold status", () => {
  const html = formatMissionProgressTelegramHtml(
    { id: "msn_<1>", name: "a&b", description: "t", status: "failed", error: { message: "boom", code: "X" } },
    "running",
    "failed"
  );
  assert.match(html, /&lt;1&gt;/);
  assert.match(html, /a&amp;b/);
  assert.match(html, /<b>failed<\/b>/);
  assert.match(html, /boom/);
});

test("slack blocks include header and fields", () => {
  const card = formatMissionProgressSlackBlocks(
    { id: "msn_s", name: "n", description: "d", status: "succeeded" },
    "running",
    "succeeded"
  );
  assert.match(card.text, /msn_s/);
  assert.ok(Array.isArray(card.blocks));
  assert.ok(card.blocks.some((b) => b.type === "header"));
  assert.ok(card.blocks.some((b) => b.type === "section"));
});

test("resolveNotifyStyle", () => {
  assert.equal(resolveNotifyStyle({}), "rich");
  assert.equal(resolveNotifyStyle({ QLING_MISSION_NOTIFY_STYLE: "plain" }), "plain");
});

test("shouldNotifyMissionLog milestone default", () => {
  assert.equal(resolveMissionLogNotifyMode({}), "milestone");
  assert.equal(
    shouldNotifyMissionLog("使命开始执行", { QLING_MISSION_NOTIFY: "on" }),
    true
  );
  assert.equal(
    shouldNotifyMissionLog("debug tick", { QLING_MISSION_NOTIFY: "on" }),
    false
  );
  assert.equal(
    shouldNotifyMissionLog("使命开始执行", { QLING_MISSION_NOTIFY_LOGS: "off" }),
    false
  );
  assert.equal(
    shouldNotifyMissionLog("debug tick", {
      QLING_MISSION_NOTIFY: "on",
      QLING_MISSION_NOTIFY_LOGS: "all",
    }),
    true
  );
});

test("formatMissionLogMessage", () => {
  const t = formatMissionLogMessage(
    { id: "msn_1", name: "n", status: "running" },
    "使命执行成功"
  );
  assert.match(t, /使命日志/);
  assert.match(t, /msn_1/);
  assert.match(t, /执行成功/);
});

test("notifyMissionProgress skips when no targets", async () => {
  const r = await notifyMissionProgress(
    {
      id: "msn_x",
      name: "n",
      description: "d",
      status: "running",
      sessionId: "s",
      lastContext: [],
      metrics: { startTime: 1, totalTurns: 0, totalTokens: 0, totalToolCalls: 0 },
      createdAt: 1,
      updatedAt: 1,
    },
    "queued",
    "running",
    { QLING_MISSION_NOTIFY: "on" }
  );
  assert.equal(r.telegram, "skipped");
  assert.equal(r.slack, "skipped");
  assert.match(r.detail, /no channel|not notable|skipped/i);
});

test("notifyMissionProgress skips queued as not notable when target is queued", async () => {
  const r = await notifyMissionProgress(
    {
      id: "msn_q",
      name: "n",
      description: "d",
      status: "queued",
      sessionId: "s",
      lastContext: [],
      metrics: { startTime: 1, totalTurns: 0, totalTokens: 0, totalToolCalls: 0 },
      createdAt: 1,
      updatedAt: 1,
    },
    null,
    "queued",
    {
      QLING_MISSION_NOTIFY: "on",
      QLING_CHANNEL_TELEGRAM_TOKEN: "tok",
      QLING_CHANNEL_TELEGRAM_ALLOWED_CHAT_IDS: '["1"]',
    }
  );
  assert.equal(r.attempted, false);
  assert.match(r.detail, /not notable/);
});

test("notifyMissionProgress treats Slack HTTP 200 ok=false as an error", async () => {
  const originalPost = axios.post;
  axios.post = async () => ({
    status: 200,
    data: { ok: false, error: "channel_not_found" },
  });
  const token = ["fixture", "slack", "token"].join("-");
  try {
    const r = await notifyMissionProgress(
      {
        id: "msn_slack_error",
        name: "n",
        description: "d",
        status: "running",
        sessionId: "s",
        lastContext: [],
        metrics: { startTime: 1, totalTurns: 0, totalTokens: 0, totalToolCalls: 0 },
        createdAt: 1,
        updatedAt: 1,
      },
      "queued",
      "running",
      {
        QLING_MISSION_NOTIFY: "on",
        QLING_CHANNEL_SLACK_BOT_TOKEN: token,
        QLING_CHANNEL_SLACK_CHANNEL_IDS: '["C404"]',
      }
    );
    assert.equal(r.slack, "error");
    assert.match(r.detail, /channel_not_found/);
    assert.doesNotMatch(r.detail, new RegExp(token));
  } finally {
    axios.post = originalPost;
  }
});
