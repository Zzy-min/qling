import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  TASK_STATUS_LABELS,
  UI_SEMANTIC_COLORS,
  taskStatusLabel,
} from "../../dist/ui-semantics.js";
import {
  formatThemePalettePreview,
  getThemePalette,
  setTheme,
  TUI_COLORS,
} from "../../dist/tui/theme.js";
import { modeAccentHex } from "../../dist/tui/mode-chrome.js";

const dashboardCss = readFileSync(
  new URL("../../src/dashboard-web/styles.css", import.meta.url),
  "utf8"
);

test("TUI bamboo and Dashboard share the same semantic colors", () => {
  setTheme("bamboo");
  const bamboo = getThemePalette("bamboo");
  assert.equal(bamboo.primary, UI_SEMANTIC_COLORS.primary);
  assert.equal(bamboo.secondary, UI_SEMANTIC_COLORS.secondary);
  assert.equal(bamboo.dim, UI_SEMANTIC_COLORS.dim);
  assert.equal(bamboo.bright, UI_SEMANTIC_COLORS.ink);
  assert.equal(bamboo.error, UI_SEMANTIC_COLORS.error);
  assert.equal(bamboo.warn, UI_SEMANTIC_COLORS.warning);
  assert.equal(TUI_COLORS.primary, UI_SEMANTIC_COLORS.primary);

  const cssTokens = {
    primary: "--primary",
    secondary: "--primary-soft",
    dim: "--dim",
    ink: "--ink",
    warning: "--warning",
    error: "--error",
  };
  for (const [key, token] of Object.entries(cssTokens)) {
    const value = UI_SEMANTIC_COLORS[key];
    assert.match(
      dashboardCss,
      new RegExp(`${token}: ${value};`),
      `${token} drifted from ui-semantics`
    );
  }
});

test("Dashboard status labels come from the shared vocabulary", () => {
  assert.equal(TASK_STATUS_LABELS.running, "运行中");
  assert.equal(taskStatusLabel("failed"), "失败");
  assert.equal(taskStatusLabel("custom"), "custom");
});

test("night theme keeps a distinct blue-purple hierarchy", () => {
  const night = getThemePalette("night");
  assert.equal(night.primary, "#8FB8FF");
  assert.equal(night.secondary, "#C4B5FD");
  assert.equal(night.thinking, "#A5B4FC");
  assert.equal(night.tool, "#93C5FD");
  assert.equal(night.error, "#FCA5A5");
  assert.equal(night.warn, "#FCD34D");
  assert.notEqual(night.primary, night.secondary);
});

test("theme preview paints a real swatch for every section role", () => {
  setTheme("bamboo");
  const preview = formatThemePalettePreview();
  assert.match(preview, /主/);
  assert.match(preview, /错误/);
  assert.match(preview, /\x1b\[38;2;102;213;139m██/);
  assert.match(preview, /\x1b\[38;2;240;149;162m██/);
  assert.equal((preview.match(/██/g) ?? []).length, 6);
});

test("mode accent uses the active theme id instead of a color-string probe", () => {
  try {
    setTheme("mono");
    assert.equal(modeAccentHex("normal"), "#F9FAFB");
    setTheme("bamboo");
    assert.equal(modeAccentHex("normal"), UI_SEMANTIC_COLORS.primary);
    assert.equal(modeAccentHex("plan"), "#38BDF8");
    assert.equal(modeAccentHex("auto"), "#FBBF24");
  } finally {
    setTheme("bamboo");
  }
});