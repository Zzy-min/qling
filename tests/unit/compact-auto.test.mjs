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
