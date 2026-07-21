import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import { SHORTCUT_DEFINITIONS, SHORTCUT_LINES, README_SHORTCUT_ROWS } from "../../dist/shortcuts.js";

test("shortcuts expose local ui entrypoints", () => {
  const text = SHORTCUT_LINES.join("\n");

  assert.match(text, /\/help/);
  assert.match(text, /\/privacy/);
  assert.match(text, /\/context/);
  assert.match(text, /\/statusline/);
  assert.match(text, /Tab[\s\S]*\/agents/);
  assert.match(text, /\/sk|slash|Slash|命令候选/);
  assert.match(text, /Tab 补全/);
  assert.match(text, /Shift\+Tab/);
  assert.match(text, /Always-approve/);
  assert.match(text, /本地 TUI|local/i);
});

test("shortcut definitions generate help and stay aligned with README", () => {
  assert.ok(SHORTCUT_DEFINITIONS.length > 10);
  assert.equal(new Set(SHORTCUT_DEFINITIONS.map((entry) => entry.id)).size, SHORTCUT_DEFINITIONS.length);
  const readme = fs.readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const normalize = (value) => value.replace(/[`。.!！\s]/g, "");
  for (const row of README_SHORTCUT_ROWS) {
    const readmeRow = readme.split(/\r?\n/).find((line) => line.startsWith(`| \`${row.key}\` |`));
    assert.ok(readmeRow && normalize(readmeRow).includes(normalize(row.behavior)), `README mismatch for ${row.key}`);
    assert.ok(SHORTCUT_LINES.some((line) => line.includes(row.key) && line.includes(row.behavior)));
  }
  const tab = SHORTCUT_DEFINITIONS.find((entry) => entry.id === "tab");
  assert.match(tab.behavior, /有轮次.*scrollback|轮次.*scrollback/i);
  assert.match(tab.behavior, /无轮次.*\/agents/);
});
