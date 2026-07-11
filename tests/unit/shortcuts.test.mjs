import test from "node:test";
import assert from "node:assert/strict";

import { SHORTCUT_LINES } from "../../dist/shortcuts.js";

test("shortcuts expose local ui entrypoints", () => {
  const text = SHORTCUT_LINES.join("\n");

  assert.match(text, /\/help/);
  assert.match(text, /\/privacy/);
  assert.match(text, /\/context/);
  assert.match(text, /\/statusline/);
  assert.match(text, /Tab agents/);
  assert.match(text, /\/sk|slash|Slash|命令候选/);
  assert.match(text, /Tab 补全/);
  assert.match(text, /Shift\+Tab/);
  assert.match(text, /Always Agree/);
  assert.match(text, /本地 TUI|local/i);
});
