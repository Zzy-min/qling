import test from "node:test";
import assert from "node:assert/strict";
import { upsertSyntheticMessage } from "../../dist/agent/synthetic-messages.js";
import { countUserTurns } from "../../dist/session/session-lifecycle.js";
import { deriveSessionTitle } from "../../dist/session/session-title.js";

test("synthetic messages are idempotent and do not become user turns or titles", () => {
  const messages = [{ role: "user", content: "真实任务" }];
  upsertSyntheticMessage(messages, "runtime_environment", "runtime", "v1");
  upsertSyntheticMessage(messages, "runtime_environment", "runtime", "v1");
  assert.equal(messages.filter((message) => message.synthetic_reason).length, 1);
  assert.equal(countUserTurns(messages), 1);
  assert.equal(deriveSessionTitle(messages), "真实任务");
});

test("new synthetic content replaces the previous reason instead of accumulating", () => {
  const messages = [];
  upsertSyntheticMessage(messages, "dynamic_context", "one");
  upsertSyntheticMessage(messages, "dynamic_context", "two");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, "two");
});
