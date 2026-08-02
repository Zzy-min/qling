import test from "node:test";
import assert from "node:assert/strict";
import { ContextCompactor, skeletonizePython, skeletonizeBraceLanguage } from "../../dist/context-compactor.js";

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

test("context-compactor: skeletonizePython folds python function bodies", () => {
  const pyCode = `class MyClass:
    def __init__(self, x):
        self.x = x
        self.init()

    def init(self):
        print("init")`;

  const skeleton = skeletonizePython(pyCode);
  assert.match(skeleton, /class MyClass:/);
  assert.match(skeleton, /def __init__\(self, x\):/);
  assert.match(skeleton, /# \.\.\. \(remaining body folded\)/);
  assert.doesNotMatch(skeleton, /self\.x = x/);
});

test("context-compactor: skeletonizeBraceLanguage folds TS method bodies", () => {
  const tsCode = `export class MyClass {
  constructor(x: number) {
    this.x = x;
  }
  getX() {
    return this.x;
  }
}`;

  const skeleton = skeletonizeBraceLanguage(tsCode);
  assert.match(skeleton, /export class MyClass \{/);
  assert.match(skeleton, /constructor\(x: number\) \{/);
  assert.match(skeleton, /\/\/ \.\.\. \(remaining body folded\)/);
  assert.doesNotMatch(skeleton, /this\.x = x/);
});

test("context-compactor: compact folds unmodified files but keeps modified files intact", async () => {
  const compactor = new ContextCompactor(6000, "deepseek-chat");
  const messages = [
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_read_unmodified",
          type: "function",
          function: { name: "read", arguments: JSON.stringify({ path: "src/unmodified.ts" }) },
        },
        {
          id: "call_read_modified",
          type: "function",
          function: { name: "read", arguments: JSON.stringify({ path: "src/modified.ts" }) },
        },
        {
          id: "call_write_modified",
          type: "function",
          function: { name: "write", arguments: JSON.stringify({ path: "src/modified.ts", content: "new code" }) },
        }
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_read_unmodified",
      content: JSON.stringify({
        tool_call_id: "call_read_unmodified",
        output: "export class Unmodified {\n  foo() {\n    console.log(1);\n  }\n}",
        is_error: false
      })
    },
    {
      role: "tool",
      tool_call_id: "call_read_modified",
      content: JSON.stringify({
        tool_call_id: "call_read_modified",
        output: "export class Modified {\n  foo() {\n    console.log(2);\n  }\n}",
        is_error: false
      })
    },
    {
      role: "tool",
      tool_call_id: "call_write_modified",
      content: JSON.stringify({
        tool_call_id: "call_write_modified",
        output: "success",
        is_error: false
      })
    }
  ];

  const result = await compactor.compact(messages, 10);

  const unmodifiedMsg = result.find(m => m.tool_call_id === "call_read_unmodified");
  const modifiedMsg = result.find(m => m.tool_call_id === "call_read_modified");

  assert.ok(unmodifiedMsg);
  assert.ok(modifiedMsg);

  const unmodifiedResult = JSON.parse(unmodifiedMsg.content);
  const modifiedResult = JSON.parse(modifiedMsg.content);

  assert.match(unmodifiedResult.output, /\/\/ \.\.\. \(remaining body folded\)/);
  assert.doesNotMatch(unmodifiedResult.output, /console\.log\(1\)/);

  assert.doesNotMatch(modifiedResult.output, /\/\/ \.\.\. \(remaining body folded\)/);
  assert.match(modifiedResult.output, /console\.log\(2\)/);
});

test("context-compactor: invalid provider summaries fall back locally without failure placeholders", async () => {
  const compactor = new ContextCompactor(1, "test", {
    summarizer: async () => "x",
    minSummaryChars: 500,
    maxSummaryAttempts: 2,
  });
  const messages = [
    { role: "user", content: "first real request" },
    { role: "assistant", content: "old answer" },
    { role: "user", content: "latest real request" },
    { role: "assistant", content: "latest answer" },
  ];
  const outcome = await compactor.compactDetailed(messages, 1);
  assert.equal(outcome.status, "compacted");
  const text = outcome.messages.map((message) => message.content).join("\n");
  assert.match(text, /确定性本地摘要/);
  assert.match(text, /latest real request/);
  assert.doesNotMatch(text, /摘要失败|无 API Key|摘要生成失败/);
  assert.equal(outcome.messages[0].synthetic_reason, "compaction_summary");
});

test("context-compactor: preserves the runtime side-effect ledger", async () => {
  const compactor = new ContextCompactor(1, "test", {
    summarizer: async () => "A sufficiently detailed summary that remains valid after compaction.",
    minSummaryChars: 20,
  });
  const ledger = {
    role: "user",
    content: "<run_side_effects>\n- C:\\repo\\a.txt：创建\n</run_side_effects>",
    synthetic_reason: "run_side_effects",
    synthetic_key: "run-side-effects-v1",
  };
  const outcome = await compactor.compactDetailed([
    ledger,
    { role: "user", content: "old task" },
    { role: "assistant", content: "old response" },
    { role: "user", content: "latest task" },
    { role: "assistant", content: "latest response" },
  ], 1);
  assert.equal(outcome.status, "compacted");
  const preserved = outcome.messages.filter(
    (message) => message.synthetic_reason === "run_side_effects"
  );
  assert.equal(preserved.length, 1);
  assert.equal(preserved[0].content, ledger.content);
});

test("context-compactor: emits a verifiable recovery checkpoint", async () => {
  const compactor = new ContextCompactor(1, "test", {
    summarizer: async () => "A sufficiently detailed recovery summary for the checkpoint.",
    minSummaryChars: 20,
  });
  const source = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message-${index}-${"x".repeat(100)}`,
  }));
  const outcome = await compactor.compactDetailed(source, 2);
  assert.equal(outcome.status, "compacted");
  assert.match(outcome.checkpoint.beforeHash, /^[a-f0-9]{64}$/);
  assert.match(outcome.checkpoint.afterHash, /^[a-f0-9]{64}$/);
  assert.equal(outcome.checkpoint.sourceMessageCount, source.length);
  assert.equal(outcome.checkpoint.resultMessageCount, outcome.messages.length);
});
