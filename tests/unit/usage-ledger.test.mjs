import test from "node:test";
import assert from "node:assert/strict";
import { UsageLedger } from "../../dist/usage-ledger.js";

test("usage ledger calculates deterministic integer-tick cost", () => {
  const ledger = new UsageLedger({ inputUsdPerMillion: "1.25", outputUsdPerMillion: "5" });
  ledger.record({ promptTokens: 1_000_000, completionTokens: 500_000 });
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.costUsd, "3.75");
  assert.equal(snapshot.costTicks, "37500000000");
  assert.equal(snapshot.costIsPartial, false);
});

test("usage ledger omits cost when price or provider usage is incomplete", () => {
  const ledger = new UsageLedger({ inputUsdPerMillion: "1" });
  ledger.record({ promptTokens: 10, completionTokens: 10 });
  ledger.markIncomplete("subagent_backgrounded");
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.costUsd, undefined);
  assert.equal(snapshot.costIsPartial, true);
  assert.equal(snapshot.usageIsIncomplete, true);
});
