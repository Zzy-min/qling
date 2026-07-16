import test from "node:test";
import assert from "node:assert/strict";
import { StreamUI } from "../../dist/tui/streaming-tui.js";

function createUi() {
  return new StreamUI("test-model", 0, { now: () => 1_000 });
}

async function withCapturedStdout(fn) {
  const originalWrite = process.stdout.write;
  process.stdout.write = function write(chunk, encoding, cb) {
    if (typeof encoding === "function") encoding();
    if (typeof cb === "function") cb();
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
}

test("filterable option picker accepts space and multi-word filter", async () => {
  await withCapturedStdout(async () => {
    const ui = createUi();
    ui.start();
    try {
      ui.showOptionPicker({
        title: "技能切换 · Skills",
        filterable: true,
        footerHint: "键入检索",
        items: [
          { id: "plan-mode", label: "plan-mode", description: "enter plan mode carefully" },
          { id: "lifecycle-ship", label: "lifecycle-ship", description: "ship checklist" },
          { id: "opencli", label: "opencli", description: "browser tools" },
        ],
        onPick: () => {},
      });
      assert.equal(ui.getOverlayKind(), "options");

      for (const ch of "plan") ui.dispatchKey(ch);
      ui.dispatchKey(" "); // 关键：空格必须插入
      ui.dispatchKey("m");

      assert.equal(ui.getInputDraft(), "plan m");
      assert.equal(ui.isOverlayOpen(), true);
      ui.dispatchKey("\x1b[B");
      ui.dismissOverlay();
      assert.equal(ui.isOverlayOpen(), false);
    } finally {
      ui.stop();
    }
  });
});

test("slash filterable space does not focus-prompt dismiss", async () => {
  await withCapturedStdout(async () => {
    const ui = createUi();
    ui.start();
    try {
      ui.setInputDraft("/");
      ui.showOptionPicker({
        title: "命令切换 · Slash",
        filterable: true,
        items: [
          { id: "/skill", label: "/skill", description: "skills" },
          { id: "/sessions", label: "/sessions", description: "sessions" },
          { id: "/status", label: "/status", description: "status" },
        ],
        onPick: () => {},
      });
      for (const ch of "skill") ui.dispatchKey(ch);
      ui.dispatchKey(" ");
      assert.equal(ui.getInputDraft(), "/skill ");
      assert.equal(ui.isOverlayOpen(), true);
      ui.dismissOverlay();
    } finally {
      ui.stop();
    }
  });
});

test("filterable overlay left arrow moves cursor in draft", async () => {
  await withCapturedStdout(async () => {
    const ui = createUi();
    ui.start();
    try {
      ui.showOptionPicker({
        title: "技能切换 · Skills",
        filterable: true,
        items: [
          { id: "alpha", label: "alpha", description: "a" },
          { id: "beta", label: "beta", description: "b" },
        ],
        onPick: () => {},
      });
      for (const ch of "ab") ui.dispatchKey(ch);
      assert.equal(ui.getInputDraft(), "ab");
      // ← 两次应把光标移到开头，再键入 x 插在最前
      ui.dispatchKey("\x1b[D");
      ui.dispatchKey("\x1b[D");
      ui.dispatchKey("x");
      assert.equal(ui.getInputDraft(), "xab");
      assert.equal(ui.isOverlayOpen(), true);
      ui.dismissOverlay();
    } finally {
      ui.stop();
    }
  });
});

test("non-filterable options still swallow space", async () => {
  await withCapturedStdout(async () => {
    const ui = createUi();
    ui.start();
    try {
      ui.setInputDraft("keep");
      ui.showOptionPicker({
        title: "主题",
        filterable: false,
        items: [
          { id: "bamboo", label: "bamboo", description: "default" },
          { id: "night", label: "night", description: "dark" },
        ],
        onPick: () => {},
      });
      ui.dispatchKey(" ");
      assert.equal(ui.getInputDraft(), "keep");
      assert.equal(ui.isOverlayOpen(), true);
      ui.dismissOverlay();
    } finally {
      ui.stop();
    }
  });
});
