import test from "node:test";
import assert from "node:assert/strict";

import {
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

test("isInternalUserNoise and tool-only helpers", () => {
  assert.equal(isInternalUserNoise("Token 预算即将耗尽（剩余 18%），请精简回复，减少工具调用频率。"), true);
  assert.equal(isInternalUserNoise("你确定是今天的吗"), false);
  assert.equal(isToolOnlyAssistantText("[tool] bash"), true);
  assert.equal(isToolOnlyAssistantText("[tool] write, [tool] bash"), true);
  assert.equal(isToolOnlyAssistantText("今天是端午节"), false);
});
