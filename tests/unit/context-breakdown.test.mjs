import test from "node:test";
import assert from "node:assert/strict";
import { estimateContextLayers } from "../../dist/context-tool-hygiene.js";
import { formatContextReport } from "../../dist/context-report.js";

test("estimateContextLayers exposes system/messages/tools/free breakdown", () => {
  const layers = estimateContextLayers(
    [
      { role: "user", content: "hello world" },
      { role: "assistant", content: "hi there" },
      { role: "tool", content: "tool-output-xxx" },
    ],
    { systemPrompt: "you are helpful", budgetChars: 1000 }
  );
  assert.ok(layers.systemChars >= "you are helpful".length);
  assert.ok(layers.messagesChars > 0);
  assert.ok(layers.toolsChars > 0);
  assert.equal(layers.userMessageCount, 1);
  assert.equal(layers.assistantMessageCount, 1);
  assert.equal(layers.toolMessageCount, 1);
  assert.ok(layers.freeChars >= 0);
  assert.equal(layers.budgetChars, 1000);
  assert.ok(layers.systemPct + layers.messagesPct + layers.toolsPct + layers.freePct <= 100.1);
});

test("formatContextReport includes breakdown section", () => {
  const layers = estimateContextLayers(
    [{ role: "user", content: "a" }, { role: "assistant", content: "b" }],
    { systemPrompt: "sys", budgetChars: 500 }
  );
  const lines = formatContextReport({
    sessionId: "s1",
    turnCount: 1,
    messageCount: 2,
    tokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    tokenSource: "unknown",
    tokenSourceDescription: "unknown",
    recommendation: "ok",
    compactions: 0,
    layers,
    workspaceDir: "/w",
    stateDir: "/s",
    cacheDir: "/c",
    sessionsDir: "/ss",
    savedSessionCount: 1,
    latestSavedSessionAt: null,
  });
  const text = lines.join("\n");
  assert.match(text, /System|Messages|Tools|Free/);
  assert.match(text, /占用分类|上下文/);
});
