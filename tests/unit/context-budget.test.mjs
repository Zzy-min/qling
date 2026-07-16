import test from "node:test";
import assert from "node:assert/strict";
import { resolveContextBudget } from "../../dist/context-budget.js";
import { resolveAutoCompactConfig } from "../../dist/session/compact-auto.js";

test("context budget uses 85 percent of an explicit model window", () => {
  const budget = resolveContextBudget({ windowTokens: 100000 });
  assert.equal(budget.source, "window");
  assert.equal(budget.triggerTokens, 85000);
});

test("unknown model window preserves the legacy 6000 trigger", () => {
  const budget = resolveContextBudget({});
  assert.equal(budget.source, "legacy");
  assert.equal(budget.triggerTokens, 6000);
});

test("auto compact resolves window and bounded ratio from env", () => {
  const config = resolveAutoCompactConfig({
    QLING_CONTEXT_WINDOW_TOKENS: "20000",
    QLING_COMPACTION_TRIGGER_RATIO: "0.8",
  });
  assert.equal(config.maxTokens, 16000);
  assert.equal(config.windowTokens, 20000);
  assert.equal(config.triggerRatio, 0.8);
});
