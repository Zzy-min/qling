import test from "node:test";
import assert from "node:assert/strict";

import {
  formatProgressPulse,
  formatProgressDuration,
} from "../../dist/tui/progress.js";
import {
  resolveBorderStyle,
  getBorderChars,
  resolveProgressStage,
  timelineStatusIcon,
  TUI_COLORS,
} from "../../dist/tui/theme.js";
import {
  formatInputFrame,
  formatToolTimelineRow,
} from "../../dist/tui/shell.js";

test("theme border style defaults to rounded and can force square", () => {
  const prev = process.env.QLING_TUI_BORDER;
  try {
    delete process.env.QLING_TUI_BORDER;
    assert.equal(resolveBorderStyle(), "rounded");
    assert.equal(getBorderChars().tl, "╭");
    process.env.QLING_TUI_BORDER = "square";
    assert.equal(resolveBorderStyle(), "square");
    assert.equal(getBorderChars().tl, "┌");
  } finally {
    if (prev === undefined) delete process.env.QLING_TUI_BORDER;
    else process.env.QLING_TUI_BORDER = prev;
  }
});

test("progress pulse encodes stage color and Chinese label", () => {
  assert.equal(resolveProgressStage("thinking"), "thinking");
  assert.equal(resolveProgressStage("工具调用"), "tool");
  assert.equal(resolveProgressStage("recover-1"), "recovery");
  const pulse = formatProgressPulse("thinking", 1200);
  assert.match(pulse, /思考/);
  assert.match(pulse, /1\.2s/);
  assert.match(pulse, /\x1b\[38;2;/);
  assert.equal(formatProgressDuration(90_000), "1m 30s");
});

test("tool timeline paints status icon without losing semantics", () => {
  const row = formatToolTimelineRow({
    tool: "read",
    command: "cat package.json",
    status: "success",
    durationMs: 42,
    width: 100,
  });
  assert.match(row, /✓/);
  assert.match(row, /读取文件/);
  assert.match(row, /package\.json/);
  assert.match(row, /42ms/);
  assert.equal(timelineStatusIcon("error"), "×");
  assert.ok(TUI_COLORS.primary.startsWith("#"));
});

test("input frame uses rounded corners by default", () => {
  const prev = process.env.QLING_TUI_BORDER;
  try {
    delete process.env.QLING_TUI_BORDER;
    const frame = formatInputFrame({
      placeholder: "输入任务，或按 / 打开命令面板",
      width: 60,
    }).join("\n");
    assert.match(frame, /╭/);
    assert.match(frame, /╰/);
    assert.match(frame, /› 输入任务/);
  } finally {
    if (prev === undefined) delete process.env.QLING_TUI_BORDER;
    else process.env.QLING_TUI_BORDER = prev;
  }
});
