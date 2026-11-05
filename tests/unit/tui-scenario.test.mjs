import test from "node:test";
import assert from "node:assert/strict";
import stringWidth from "string-width";
import { FullscreenRenderer } from "../../dist/tui/fullscreen.js";

test("scripted terminal scenario: scrolled resize keeps a valid frame and scrollbar", () => {
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 100, rows: 24, colorMode: "none" },
    { write: () => {} }
  );
  renderer.start();
  for (let i = 0; i < 80; i++) renderer.appendNotice(`history-${i}`);
  renderer.scrollLines(12);
  renderer.resize({ stdinTTY: true, stdoutTTY: true, columns: 60, rows: 14, colorMode: "none" });
  const screen = renderer.snapshot();
  assert.ok(screen.length === 14);
  assert.ok(screen.every((line) => stringWidth(line) === 60));
  assert.match(screen.join("\n"), /已离开底部/);

  renderer.scrollEnd();
  assert.doesNotMatch(renderer.snapshot().join("\n"), /已离开底部/);
  renderer.stop();
});
