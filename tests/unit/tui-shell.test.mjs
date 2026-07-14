import test from "node:test";
import assert from "node:assert/strict";

import {
  formatBottomHints,
  formatInputFrame,
  formatResultBox,
  formatResultHighlight,
  formatRoleHeader,
  formatToolOutputCard,
  formatToolTimelineRow,
  formatTopBar,
  formatWelcomeGuide,
  padVisible,
  truncateVisible,
  visibleWidth,
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
    sessionMode: "plan",
    permissionMode: "ask",
    width: 120,
  });
  const text = lines.join("\n");

  assert.equal(lines.length, 2);
  assert.match(text, /轻灵 Qling v0\.5\.0/);
  assert.match(text, /Workspace: agent-cli/);
  assert.match(text, /Model: qling-agent-1\.0/);
  assert.match(text, /Mode:plan/);
  assert.match(text, /Perm:ask/);
  assert.match(text, /就绪/);
  // Tokens/Git 在宽屏保留；窄宽可截断，但 120 列应至少容纳 Mode/Perm/就绪
  assert.match(text, /Tokens:12\.4k|Tokens: 12\.4k|就绪/);
});

test("formatToolOutputCard collapses long output and expands on request", () => {
  const long = Array.from({ length: 15 }, (_, i) => `line-${i + 1}`).join("\n");
  const collapsed = formatToolOutputCard(long, { expand: false });
  assert.equal(collapsed.collapsed, true);
  assert.ok(collapsed.hidden > 0);
  assert.match(collapsed.displayLines.join("\n"), /\.\.\. \+\d+ lines/);
  assert.match(String(collapsed.footer), /Ctrl\+O/);

  const expanded = formatToolOutputCard(long, { expand: true });
  assert.equal(expanded.collapsed, false);
  assert.equal(expanded.hidden, 0);
  assert.equal(expanded.displayLines.length, 15);
  assert.match(String(expanded.footer), /collapse/i);
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
  const highlightLines = formatResultHighlight({
    header: "结果",
    lines: ["项目采用模块化结构。", "可直接进入下一任务。", "\x1b[32m短ANSI行\x1b[0m"],
    width: 80,
  });
  const highlight = highlightLines.join("\n");

  assert.match(box, /┌/);
  assert.match(box, /src\//);
  assert.match(input, /› 输入任务，或按 \/ 打开命令面板/);
  assert.match(input, /└/);
  assert.match(highlight, /结果/);
  assert.match(highlight, /模块化结构/);
  assert.match(highlight, /┌─/);
  assert.match(highlight, /└/);
  // 左右边框完整闭合，且各行可见宽度一致（右侧不再缺边）
  const frameW = visibleWidth(highlightLines[0]);
  for (const line of highlightLines) {
    assert.equal(visibleWidth(line), frameW, `frame width mismatch: ${line}`);
    assert.match(line, /[│┌└]/);
    assert.match(line, /[│┐┘]$/);
  }
  // formatBottomHints 仍供帮助文案使用，不再强制画在输入框上方
  assert.match(hints, /Enter 发送/);
  assert.match(hints, /命令|命令面板/);
  assert.match(hints, /Ctrl\+C/);
  assert.match(hints, /statusline/i);
  assert.match(hints, /expand|Ctrl\+O/i);
  assert.doesNotMatch(hints, /\/model 切换模型/);
  assert.doesNotMatch(hints, /\/exit 退出/);
});

test("tui shell formats result box with P1 long-output compact", () => {
  const longLines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const compact = formatResultBox(longLines, 80, { compactLong: true }).join("\n");
  assert.match(compact, /长输出已折叠/);
  assert.match(compact, /20/);
  // 头部和尾部保留
  assert.match(compact, /line 0/);
  assert.match(compact, /line 19/);
});

test("tui shell formats enhanced home welcome with snapshot (P1)", () => {
  const home = formatWelcomeGuide(80, {
    model: "deepseek-chat",
    workspace: "/proj/qling",
    memoryStatus: "跨会话",
    permissionMode: "ask",
    recentSessions: ["sess-abc123", "sess-def456"],
  }).join("\n");

  assert.match(home, /轻灵 · 本地工作台/);
  assert.match(home, /模型.*deepseek-chat/);
  assert.match(home, /记忆.*跨会话/);
  assert.match(home, /最近会话.*sess-abc/);
  assert.doesNotMatch(home, /3 步开始/);
  assert.doesNotMatch(home, /常用入口/);
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
  assert.doesNotMatch(text, /3 步开始/);
  assert.doesNotMatch(text, /常用入口/);
});

test("visibleWidth counts CJK fullwidth and ASCII halfwidth", () => {
  assert.equal(visibleWidth("abc"), 3);
  assert.equal(visibleWidth("轻灵"), 4);
  assert.equal(visibleWidth("轻灵Qling"), 4 + 5);
  assert.equal(visibleWidth("你好世界"), 8);
});

test("truncateVisible does not split mid-CJK and leaves room for ellipsis", () => {
  const text = "中文宽度测试ABC";
  const truncated = truncateVisible(text, 6);
  assert.ok(visibleWidth(truncated) <= 6);
  assert.match(truncated, /…$/);
});

test("padVisible aligns to target width for mixed CJK", () => {
  const padded = padVisible("轻灵", 10);
  assert.equal(visibleWidth(padded), 10);
});

test("formatToolOutputCard footer is bilingual for expand/collapse", () => {
  const long = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n");
  const collapsed = formatToolOutputCard(long, { expand: false });
  assert.equal(collapsed.collapsed, true);
  assert.match(collapsed.footer ?? "", /Ctrl\+O.*展开/);
  const expanded = formatToolOutputCard(long, { expand: true });
  assert.equal(expanded.collapsed, false);
  assert.match(expanded.footer ?? "", /Ctrl\+O.*收起/);
});
