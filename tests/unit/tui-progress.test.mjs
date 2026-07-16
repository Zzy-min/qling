import test from "node:test";
import assert from "node:assert/strict";

import { formatProgressDuration, formatProgressPulse } from "../../dist/tui/progress.js";

test("tui progress duration formats seconds", () => {
  assert.equal(formatProgressDuration(0), "0.0s");
  assert.equal(formatProgressDuration(12_345), "12.3s");
});

test("tui progress duration formats minutes", () => {
  assert.equal(formatProgressDuration(65_000), "1m 5s");
});

test("tui progress pulse includes local stage and elapsed time", () => {
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
  assert.equal(strip(formatProgressPulse("agent", 12_000)), "⠋  agent 仍在运行 (12.0s)");
  assert.equal(strip(formatProgressPulse("", 1_000)), "⠹  agent 仍在运行 (1.0s)");
});
