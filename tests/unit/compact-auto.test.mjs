import test from "node:test";
import assert from "node:assert/strict";
import { resolveAutoCompactConfig } from "../../dist/session/compact-auto.js";

test("auto compact defaults to enabled with 6000 threshold", () => {
  const cfg = resolveAutoCompactConfig({});
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.maxTokens, 6000);
  assert.equal(cfg.recentKeep, 6);
});

test("auto compact can be disabled and tuned via env", () => {
  assert.equal(resolveAutoCompactConfig({ QLING_AUTO_COMPACT: "0" }).enabled, false);
  assert.equal(resolveAutoCompactConfig({ QLING_AUTO_COMPACT: "off" }).enabled, false);
  assert.equal(resolveAutoCompactConfig({ QLING_AUTO_COMPACT: "1" }).enabled, true);
  assert.equal(
    resolveAutoCompactConfig({ QLING_COMPACT_MAX_TOKENS: "12000" }).maxTokens,
    12000
  );
  assert.equal(
    resolveAutoCompactConfig({ QLING_COMPACT_RECENT_KEEP: "10" }).recentKeep,
    10
  );
});

test("auto compact uses the known model window when config window is unset", () => {
  const kimi = resolveAutoCompactConfig({}, "kimi-k3");
  assert.equal(kimi.budgetSource, "model");
  assert.equal(kimi.windowTokens, 1000000);
  assert.equal(kimi.maxTokens, 850000);
  const deepseek = resolveAutoCompactConfig({}, "deepseek-flash");
  assert.equal(deepseek.budgetSource, "model");
  assert.equal(deepseek.windowTokens, 1000000);
  assert.equal(deepseek.maxTokens, 850000);
  assert.ok(deepseek.maxTokens > 6000);
});

test("unknown model keeps the legacy 6000 trigger and labels it", () => {
  const unknown = resolveAutoCompactConfig({}, "not-a-real-model");
  assert.equal(unknown.budgetSource, "legacy");
  assert.equal(unknown.maxTokens, 6000);
  assert.equal(unknown.windowTokens, null);
});
