import test from "node:test";
import assert from "node:assert/strict";
import { StreamUI } from "../../dist/tui/streaming-tui.js";
import { resolveDashboardSurface } from "../../dist/commands/dashboard.js";

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

test("filterable slash Enter submits full dashboard web draft", async () => {
  await withCapturedStdout(async () => {
    const ui = createUi();
    ui.start();
    const submitted = [];
    ui.onInput(async (cmd) => {
      submitted.push(cmd);
    });
    try {
      ui.showOptionPicker({
        title: "命令切换 · Slash",
        filterable: true,
        items: [
          { id: "/dashboard", label: "/dashboard", description: "fleet or web" },
          { id: "/sessions", label: "/sessions", description: "sessions" },
        ],
        onPick: async (item) => {
          submitted.push(`pick:${item.id}`);
        },
      });
      ui.setInputDraft("/dashboard web");
      ui.dispatchKey("\r");
      await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(submitted, ["/dashboard web"]);
      assert.equal(ui.isOverlayOpen(), false);
    } finally {
      ui.stop();
    }
  });
});

test("bulk paste into filterable slash inserts draft", async () => {
  await withCapturedStdout(async () => {
    const ui = createUi();
    ui.start();
    try {
      ui.showOptionPicker({
        title: "命令切换 · Slash",
        filterable: true,
        items: [
          { id: "/dashboard", label: "/dashboard", description: "fleet or web" },
          { id: "/skill", label: "/skill", description: "skills" },
        ],
        onPick: () => {},
      });
      ui.setInputDraft("");
      for (const ch of "/dashboard web") {
        ui.dispatchKey(ch);
      }
      assert.equal(ui.getInputDraft(), "/dashboard web");
      assert.equal(ui.isOverlayOpen(), true);
    } finally {
      ui.stop();
    }
  });
});

test("surface open maps to web mode", () => {
  assert.equal(resolveDashboardSurface(["web"]), "web");
  assert.equal(resolveDashboardSurface(["url"]), "web");
  assert.equal(resolveDashboardSurface(["open"]), "web");
  assert.equal(resolveDashboardSurface([]), "tui");
});
