import test from "node:test";
import assert from "node:assert/strict";

import { formatTuiHeader } from "../../dist/tui/chrome.js";

test("tui chrome formats a branded local-first slash-first header", () => {
  const lines = formatTuiHeader({
    model: "test-model",
    tools: 7,
    cwd: "C:\\repo\\qling",
  });
  const text = lines.join("\n");

  assert.equal(lines.length, 4);
  assert.match(text, /轻灵 · Agent CLI/);
  assert.match(text, /model=test-model\s+tools=7\s+mode=local-first/);
  assert.match(text, /workspace=C:\/repo\/qling/);
  assert.match(text, /\/help slash/);
  assert.match(text, /Tab agents/);
  assert.match(text, /Ctrl\+Z restore/);
  assert.match(text, /Ctrl\+O output/);
  assert.match(text, /\/privacy boundary/);
});

test("tui chrome degrades empty values without mutating inputs", () => {
  const options = { model: "", tools: -2, cwd: "" };
  const lines = formatTuiHeader(options);
  const text = lines.join("\n");

  assert.deepEqual(options, { model: "", tools: -2, cwd: "" });
  assert.match(text, /model=unknown/);
  assert.match(text, /tools=0/);
  assert.match(text, /workspace=-/);
});
