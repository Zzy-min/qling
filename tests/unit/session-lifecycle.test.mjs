import test from "node:test";
import assert from "node:assert/strict";

import {
  countUserTurns,
  resolveForkName,
  resolveRewindTurns,
  rewindByUserTurns,
  isUserTurnStart,
} from "../../dist/session/session-lifecycle.js";

const msgs = [
  { role: "user", content: "第一问" },
  { role: "assistant", content: "答1" },
  {
    role: "user",
    content: "Token 预算即将耗尽（剩余 10%），请精简回复，减少工具调用频率。",
  },
  { role: "assistant", content: "精简中" },
  { role: "user", content: "第二问" },
  { role: "assistant", content: "答2" },
  { role: "user", content: "第三问" },
  { role: "assistant", content: "答3", tool_calls: [{ function: { name: "bash" } }] },
  { role: "tool", content: "ok" },
];

test("countUserTurns skips budget noise", () => {
  assert.equal(countUserTurns(msgs), 3);
  assert.equal(isUserTurnStart(msgs[0]), true);
  assert.equal(isUserTurnStart(msgs[2]), false);
});

test("rewindByUserTurns removes last n real user turns", () => {
  const one = rewindByUserTurns(msgs, 1);
  assert.equal(one.removedTurns, 1);
  assert.equal(one.remainingTurns, 2);
  assert.equal(one.messages.some((m) => m.content === "第三问"), false);
  assert.equal(one.messages.some((m) => m.content === "第二问"), true);

  const two = rewindByUserTurns(msgs, 2);
  assert.equal(two.removedTurns, 2);
  assert.equal(two.remainingTurns, 1);
  assert.equal(two.messages.at(-1)?.content, "精简中");

  const all = rewindByUserTurns(msgs, 99);
  assert.equal(all.removedTurns, 3);
  assert.equal(all.remainingTurns, 0);
  assert.equal(all.messages.length, 0);
});

test("resolveRewindTurns and resolveForkName", () => {
  assert.equal(resolveRewindTurns(undefined), 1);
  assert.equal(resolveRewindTurns(["3"]), 3);
  assert.equal(resolveRewindTurns(["x"]), 1);
  assert.equal(resolveForkName(["my/branch"], "session-1"), "my-branch");
  assert.equal(resolveForkName([], "session-9"), "session-9");
});
