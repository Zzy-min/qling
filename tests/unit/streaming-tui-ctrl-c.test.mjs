import test from "node:test";
import assert from "node:assert/strict";

import { StreamUI } from "../../dist/tui/streaming-tui.js";

async function withCapturedStdout(fn) {
  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write = function write(chunk, encoding, cb) {
    output += String(chunk);
    if (typeof encoding === "function") encoding();
    if (typeof cb === "function") cb();
    return true;
  };
  try {
    await fn(() => output);
  } finally {
    process.stdout.write = originalWrite;
  }
}

function createUi(now = () => 1_000) {
  const ui = new StreamUI("test-model", 0, { now });
  const submitted = [];
  ui.onInput(async (cmd) => {
    submitted.push(cmd);
  });
  return { ui, submitted };
}

test("stream ui ctrl+c clears non-empty input without submitting exit", async () => {
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();

    ui.input.insertChar("h");
    ui.input.insertChar("i");
    ui.handleCtrlC();

    assert.equal(ui.input.value, "");
    assert.deepEqual(submitted, []);
  });
});

test("stream ui first empty ctrl+c prints local exit hint without submitting", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();

    ui.handleCtrlC();

    assert.deepEqual(submitted, []);
    assert.match(getOutput(), /再次 Ctrl\+C 退出，或输入 exit/);
  });
});

test("stream ui second empty ctrl+c within window submits exit", async () => {
  let now = 1_000;
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi(() => now);

    ui.handleCtrlC();
    now += 1_500;
    ui.handleCtrlC();

    assert.deepEqual(submitted, ["exit"]);
  });
});

test("stream ui empty ctrl+c after timeout does not submit exit", async () => {
  let now = 1_000;
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi(() => now);

    ui.handleCtrlC();
    now += 2_500;
    ui.handleCtrlC();

    assert.deepEqual(submitted, []);
  });
});

test("stream ui ctrl+a and ctrl+e move cursor without submitting", async () => {
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();
    for (const ch of "abc") ui.input.insertChar(ch);
    ui.handleCtrlA();
    assert.equal(ui.input.cursorPos, 0);

    ui.handleCtrlE();
    assert.equal(ui.input.cursorPos, 3);
    assert.deepEqual(submitted, []);
  });
});

test("stream ui ctrl+u and ctrl+k edit buffer without submitting", async () => {
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();
    for (const ch of "abcdef") ui.input.insertChar(ch);
    ui.input.moveLeft();
    ui.input.moveLeft();

    ui.handleCtrlU();
    assert.equal(ui.input.value, "ef");
    assert.equal(ui.input.cursorPos, 0);

    ui.input.insertChar("X");
    ui.handleCtrlK();
    assert.equal(ui.input.value, "X");
    assert.equal(ui.input.cursorPos, 1);
    assert.deepEqual(submitted, []);
  });
});
