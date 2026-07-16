import test from "node:test";
import assert from "node:assert/strict";
import {
  ScrollbackViewport,
  wrapViewportText,
} from "../../dist/tui/scrollback-viewport.js";
import { visibleWidth } from "../../dist/tui/shell.js";

test("managed viewport groups user, assistant and tool content into a real turn", () => {
  const viewport = new ScrollbackViewport();
  viewport.startUserTurn("检查项目状态");
  viewport.appendAssistant("当前分支是 main");
  viewport.appendTool("git", "status --short\nclean");
  const snapshot = viewport.snapshot(60, 20);
  const text = snapshot.lines.join("\n");
  assert.equal(snapshot.turnCount, 1);
  assert.match(text, /【你】/);
  assert.match(text, /检查项目状态/);
  assert.match(text, /【轻灵】/);
  assert.match(text, /当前分支是 main/);
  assert.match(text, /【工具 git】/);
  assert.match(text, /status --short/);
});

test("managed viewport pages within a long turn without cycling", () => {
  const viewport = new ScrollbackViewport();
  viewport.startUserTurn("开始长任务");
  viewport.appendAssistant(Array.from({ length: 30 }, (_, i) => `line-${i + 1}`).join("\n"));
  const tail = viewport.snapshot(40, 6);
  assert.ok(tail.pageCount > 1);
  assert.equal(tail.page, tail.pageCount);
  const previous = viewport.scrollPage(-1, 40, 6);
  assert.equal(previous.page, tail.pageCount - 1);
  const first = Array.from({ length: 20 }).reduce(
    () => viewport.scrollPage(-1, 40, 6),
    previous
  );
  assert.equal(first.page, 1);
  assert.equal(viewport.scrollPage(-1, 40, 6).page, 1);
});

test("managed viewport keeps bounded recent turns and CJK wrapping width", () => {
  const viewport = new ScrollbackViewport({ maxTurns: 2 });
  viewport.startUserTurn("first");
  viewport.startUserTurn("second");
  viewport.startUserTurn("第三轮中文内容");
  assert.equal(viewport.getTurnCount(), 2);
  assert.equal(viewport.getTurnPreview(0), "second");
  for (const line of wrapViewportText("中文中文中文ABC", 6)) {
    assert.ok(visibleWidth(line) <= 6);
  }
});
