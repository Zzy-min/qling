import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyReplayMessage,
  deriveSessionTitle,
  isInternalUserNoise,
  isToolOnlyAssistantText,
} from "../../dist/session/session-title.js";

test("deriveSessionTitle uses first real user question", () => {
  const title = deriveSessionTitle([
    { role: "system", content: "sys" },
    {
      role: "user",
      content: "Token 预算即将耗尽（剩余 10%），请精简回复，减少工具调用频率。",
    },
    { role: "user", content: "今天开市了吗" },
    { role: "assistant", content: "查一下" },
  ]);
  assert.equal(title, "今天开市了吗");
});

test("deriveSessionTitle falls back to empty when only noise", () => {
  assert.equal(
    deriveSessionTitle([
      {
        role: "user",
        content: "Token 预算即将耗尽（剩余 2%），请精简回复，减少工具调用频率。",
      },
    ]),
    ""
  );
});

test("deriveSessionTitle skips compaction memory summary", () => {
  const title = deriveSessionTitle([
    {
      role: "user",
      content:
        "【会话记忆摘要（压缩后）】 #### 已完成的关键任务和结果 - **执行查询**",
    },
    { role: "user", content: "今天的日期" },
  ]);
  assert.equal(title, "今天的日期");
});

test("classifyReplayMessage keeps the conversation and drops workspace plus tool preambles' raw role", () => {
  assert.equal(
    classifyReplayMessage({
      role: "user",
      content: "<user_info>\nworkspace=WORKSPACE_SECRET\n</user_info>",
      synthetic_reason: "runtime_environment",
    }),
    null
  );
  assert.equal(
    classifyReplayMessage({
      role: "user",
      content: "<dynamic_context>\nAGENTS rules dump\n</dynamic_context>",
    }),
    null
  );
  assert.equal(classifyReplayMessage({ role: "tool", content: "tool body" }), null);
  assert.equal(classifyReplayMessage({ role: "system", content: "hidden-system" }), null);
  assert.equal(
    classifyReplayMessage({
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "bash" } }],
    }),
    null
  );

  const thinking = classifyReplayMessage({
    role: "assistant",
    content: "先读 streaming-tui.ts。\nGUESS_NOT_A_STEP",
    tool_calls: [{ function: { name: "read" } }],
    reasoning_content: "REASONING_CHAIN_SECRET",
  });
  assert.equal(thinking.role, "thinking");
  assert.match(thinking.text, /先读 streaming-tui\.ts/);
  assert.doesNotMatch(thinking.text, /REASONING_CHAIN_SECRET/);

  assert.deepEqual(
    classifyReplayMessage({ role: "assistant", content: "滑块已改为两格。" }),
    { role: "result", text: "滑块已改为两格。" }
  );
  assert.deepEqual(
    classifyReplayMessage({ role: "user", content: "请看一下滑块" }),
    { role: "user", text: "请看一下滑块" }
  );
});

test("isInternalUserNoise and tool-only helpers", () => {
  assert.equal(isInternalUserNoise("Token 预算即将耗尽（剩余 18%），请精简回复，减少工具调用频率。"), true);
  assert.equal(isInternalUserNoise("你确定是今天的吗"), false);
  assert.equal(isToolOnlyAssistantText("[tool] bash"), true);
  assert.equal(isToolOnlyAssistantText("[tool] write, [tool] bash"), true);
  assert.equal(isToolOnlyAssistantText("今天是端午节"), false);
});
