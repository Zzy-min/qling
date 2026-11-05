import test from "node:test";
import assert from "node:assert/strict";
import stringWidth from "string-width";

import { FullscreenRenderer } from "../../dist/tui/fullscreen.js";
import {
  contentOffsetToScrollOffset,
  scrollbarClickToOffset,
  scrollbarThumb,
  scrollOffsetToContentOffset,
} from "../../dist/tui/scrollbar.js";
import { extractImportantSteps } from "../../dist/tui/thinking-fold.js";
import { StreamUI } from "../../dist/tui/streaming-tui.js";

const stripAnsi = (value) => value.replace(/\x1b\[[0-9;]*m/g, "");

function renderer(columns = 80, rows = 24) {
  return new FullscreenRenderer(
    { workspace: "agent-cli", model: "qling-agent-1.0", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns, rows, colorMode: "none" },
    { write: () => {} },
  );
}

test("scrollbar thumb sits at the bottom while following and jumps from the track", () => {
  const thumb = scrollbarThumb(18, 80, 18, 62);
  assert.ok(thumb);
  assert.equal(thumb.length, 2);
  assert.equal(thumb.start + thumb.length, 18);

  const barely = scrollbarThumb(18, 20, 18, 2);
  assert.ok(barely);
  assert.equal(barely.length, 2);

  assert.deepEqual(scrollbarClickToOffset(0, 18, 80, 18), { kind: "top" });
  assert.deepEqual(scrollbarClickToOffset(17, 18, 80, 18), { kind: "bottom" });

  const middle = scrollbarClickToOffset(9, 18, 80, 18);
  assert.equal(middle.kind, "offset");
  assert.ok(middle.offsetFromTop > 0 && middle.offsetFromTop < 62);

  assert.equal(scrollOffsetToContentOffset(0, 63, 80, 18), 62);
  assert.equal(contentOffsetToScrollOffset(62, 63, 80, 18), 0);
  assert.equal(contentOffsetToScrollOffset(0, 63, 80, 18), 63);
});

test("fullscreen right rail draws a thumb and click-jumps to the top", () => {
  const ui = renderer();
  ui.start();
  for (let index = 0; index < 40; index += 1) ui.appendNotice(`历史 ${index}`);
  const following = ui.snapshot();
  assert.equal(following.length, 24);
  assert.ok(following.every((line) => stringWidth(line) <= 80));
  assert.ok(!following[2].endsWith("█"));
assert.ok(following[following.length - 5].endsWith("█"));
  assert.doesNotMatch(following.join("\n"), /已离开底部/);

  ui.handleMouse({ kind: "down", column: 80, row: 3 });
  ui.handleMouse({ kind: "up", column: 80, row: 3 });
  const jumped = ui.snapshot();
  assert.match(jumped.join("\n"), /历史 0/);
  assert.match(jumped.join("\n"), /已离开底部/);
assert.ok(jumped[2].endsWith("█"));
  ui.stop();
});

test("reading history stays put while a new task appends output", () => {
  const ui = renderer();
  ui.start();
  for (let index = 0; index < 40; index += 1) ui.appendNotice(`历史 ${index}`);
  ui.scrollLines(999);
  const parked = ui.snapshot();
  assert.match(parked.join("\n"), /历史 0/);
  assert.ok(parked[2].endsWith("█"));

  ui.appendNotice("新任务输出");
  ui.setProgress("模型响应", 400);
  ui.streamAssistant("正在生成一段很长的新回答。".repeat(30));
  const during = ui.snapshot();
  assert.match(during.join("\n"), /历史 0/);
  assert.match(during.join("\n"), /已离开底部/);
  assert.doesNotMatch(during.join("\n"), /新任务输出/);
  assert.doesNotMatch(during.join("\n"), /正在生成/);
  assert.ok(during[2].endsWith("█"));

  ui.scrollEnd();
  ui.appendNotice("回到底部");
  const followed = ui.snapshot().join("\n");
  assert.match(followed, /回到底部/);
  assert.doesNotMatch(followed, /已离开底部/);
  ui.stop();
});

test("thinking chain stays folded to important steps until Ctrl+E", () => {
  const chain = [
    "让我想想。",
    "先读 package.json，确认脚本。",
    "然后跑单元测试。",
    "这里有一段很长的猜测，先不改实现。",
    "最后改右侧滑块。",
    "再核对边框宽度。",
  ].join("\n");
  const folded = extractImportantSteps(chain, 3);
  assert.deepEqual(folded.steps, [
    "先读 package.json，确认脚本。",
    "最后改右侧滑块。",
    "再核对边框宽度。",
  ]);
  assert.equal(folded.hidden, 3);
  assert.equal(folded.expandable, true);

  const ui = renderer();
  ui.start();
  ui.streamAssistant(chain);
  ui.foldAssistantIntoThinking(chain, 1200);
  const collapsed = ui.snapshot().join("\n");
  assert.match(collapsed, /思考了 1\.2s/);
  assert.match(collapsed, /先读 package\.json/);
  assert.match(collapsed, /最后改右侧滑块/);
  assert.match(collapsed, /再核对边框宽度/);
  assert.doesNotMatch(collapsed, /让我想想/);
  assert.doesNotMatch(collapsed, /先不改实现/);
  assert.doesNotMatch(collapsed, /轻灵 {2}· {2}流式/);
  assert.match(collapsed, /Ctrl\+E 展开/);

  assert.equal(ui.toggleThinking(), true);
  const expanded = ui.snapshot().join("\n");
  assert.match(expanded, /让我想想/);
  assert.match(expanded, /Ctrl\+E 折叠/);
  ui.stop();
});

test("classic thinking output keeps the decision and drops filler", async () => {
  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write = function write(chunk, encoding, cb) {
    output += String(chunk);
    if (typeof encoding === "function") encoding();
    if (typeof cb === "function") cb();
    return true;
  };
  try {
    const ui = new StreamUI("test-model", 0, { now: () => 1_000, tuiMode: "classic" });
    ui.appendThinking([
      "让我想想。",
      "先读 package.json。",
      "然后跑测试。",
      "中间再猜一次缓存。",
      "最后改滑块。",
    ].join("\n"));
    const plain = stripAnsi(output);
    assert.match(plain, /◇ {2}思考/);
    assert.match(plain, /先读 package\.json/);
    assert.match(plain, /然后跑测试/);
    assert.match(plain, /最后改滑块/);
    assert.doesNotMatch(plain, /让我想想/);
    assert.match(plain, /另有 \d+ 步/);
  } finally {
    process.stdout.write = originalWrite;
  }
});




