import test from "node:test";
import assert from "node:assert/strict";

import {
  formatBottomHints,
  formatInputFrame,
  formatResultBox,
  formatRoleHeader,
  formatToolTimelineRow,
  formatTopBar,
  formatWelcomeGuide,
} from "../../dist/tui/shell.js";

test("tui shell formats screenshot-style top bar", () => {
  const lines = formatTopBar({
    productName: "轻灵",
    englishName: "Qling",
    version: "0.5.0",
    workspace: "agent-cli",
    model: "qling-agent-1.0",
    ready: true,
    tokens: 12_400,
    branch: "main",
    width: 120,
  });
  const text = lines.join("\n");

  assert.equal(lines.length, 2);
  assert.match(text, /轻灵 Qling v0\.5\.0/);
  assert.match(text, /Workspace: agent-cli/);
  assert.match(text, /Model: qling-agent-1\.0/);
  assert.match(text, /就绪/);
  assert.match(text, /Tokens: 12\.4k/);
  assert.match(text, /Git: main/);
});

test("tui shell formats role headers for user, assistant, and execution state", () => {
  assert.match(formatRoleHeader("user"), /You/);
  assert.match(formatRoleHeader("assistant"), /轻灵/);
  assert.match(formatRoleHeader("executing"), /正在执行/);
});

test("tui shell formats tool timeline rows with chinese action and duration", () => {
  const readRow = formatToolTimelineRow({
    tool: "read",
    command: "cat package.json",
    status: "success",
    durationMs: 89,
    width: 100,
  });
  const bashRow = formatToolTimelineRow({
    tool: "bash",
    command: "npm run build",
    status: "running",
    durationMs: 0,
    width: 100,
  });

  assert.match(readRow, /✓/);
  assert.match(readRow, /读取文件/);
  assert.match(readRow, /package\.json/);
  assert.match(readRow, /89ms/);
  assert.match(bashRow, /执行命令/);
  assert.match(bashRow, /npm run build/);
});

test("tui shell formats result boxes and bottom input hints", () => {
  const box = formatResultBox([".", "├── src/", "└── README.md"], 80).join("\n");
  const input = formatInputFrame({ placeholder: "输入任务，或按 / 打开命令面板", width: 80 }).join("\n");
  const hints = formatBottomHints();

  assert.match(box, /┌/);
  assert.match(box, /src\//);
  assert.match(input, /› 输入任务，或按 \/ 打开命令面板/);
  assert.match(input, /└/);
  assert.match(hints, /Enter 发送/);
  assert.match(hints, /Ctrl\+C/);
  assert.match(hints, /\/model 切换模型/);
  assert.match(hints, /\/exit 退出/);
});

test("tui shell formats enhanced home welcome with snapshot (P1)", () => {
  const lines = formatWelcomeGuide(80, {
    model: "deepseek-chat",
    workspace: "/proj/qling",
    memoryStatus: "本地",
    permissionMode: "ask",
    recentSessions: ["sess-123"],
  });
  const text = lines.join("\n");
  assert.match(text, /轻灵 · 本地工作台/);
  assert.match(text, /模型: deepseek-chat/);
  assert.match(text, /记忆状态: 本地/);
  assert.match(text, /权限模式: ask/);
  assert.match(text, /最近会话/);
});
