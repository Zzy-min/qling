import test from "node:test";
import assert from "node:assert/strict";
import { TurnClaimRegistry } from "../../dist/runtime/turn-claim.js";

test("turn claim commits once and rejects stale generations", () => {
  const registry = new TurnClaimRegistry();
  const first = registry.begin("run-a", "turn-1");
  assert.equal(registry.commit(first), true);
  assert.equal(registry.commit(first), false, "terminal report commits only once");

  const second = registry.begin("run-b", "turn-2");
  assert.equal(registry.tryClaim(first), false, "old turn cannot claim new generation");
  assert.equal(registry.commit(second), true);
  registry.release(second);
  assert.equal(registry.tryClaim(second), false, "released claim cannot commit");
});

test("turn claim marks the slot held and then reported", () => {
  const registry = new TurnClaimRegistry();
  const token = registry.begin("run-a", "turn-1");
  assert.match(token.claimId, /^1:\d+$/);
  assert.equal(registry.tryClaim(token), true);
  assert.deepEqual(registry.inspect(), { held: true, reported: false, claimId: token.claimId });
  assert.equal(registry.tryClaim(token), false, "held slot cannot be claimed twice");
  assert.equal(registry.commit(token), true);
  assert.deepEqual(registry.inspect(), { held: false, reported: true, claimId: token.claimId });
  assert.equal(registry.commit(token), false);
});
