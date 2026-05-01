import test from "node:test";
import assert from "node:assert/strict";

import { ContextCompactor } from "../../dist/context-compactor.js";

test("context-compactor: preserves assistant tool_call before tool message", async () => {
  const compactor = new ContextCompactor(1, "deepseek-chat");
  const messages = [
    { role: "user", content: "task" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "t1",
          type: "function",
          function: { name: "read", arguments: "{}" },
        },
      ],
    },
    { role: "tool", content: "ok", tool_call_id: "t1" },
  ];

  const out = await compactor.compact(messages, 1);
  const assistantIdx = out.findIndex((m) => m.role === "assistant");
  const toolIdx = out.findIndex((m) => m.role === "tool");

  assert.ok(assistantIdx >= 0, "assistant with tool_calls should be kept");
  assert.ok(toolIdx >= 0, "tool message should be kept");
  assert.ok(assistantIdx < toolIdx, "assistant should remain before tool");
});

test("context-compactor: no-matching assistant degrades gracefully without crash", async () => {
  const compactor = new ContextCompactor(1, "deepseek-chat");
  const messages = [
    { role: "user", content: "task" },
    { role: "tool", content: "orphan", tool_call_id: "missing" },
  ];

  const out = await compactor.compact(messages, 1);
  const toolIdx = out.findIndex((m) => m.role === "tool");

  assert.ok(toolIdx >= 0, "orphan tool should still be retained safely");
});
