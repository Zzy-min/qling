import test from "node:test";
import assert from "node:assert/strict";

import {
  extractProviderUsage,
  resolveRoundTokenUsage,
  formatProviderTokenLine,
} from "../../dist/token-usage.js";

test("extractProviderUsage reads OpenAI-compatible usage", () => {
  const usage = extractProviderUsage({
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
  });
  assert.deepEqual(
    { promptTokens: usage?.promptTokens, completionTokens: usage?.completionTokens, totalTokens: usage?.totalTokens },
    { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
  );
});

test("extractProviderUsage sums prompt+completion when total missing", () => {
  const usage = extractProviderUsage({
    input_tokens: 40,
    output_tokens: 10,
  });
  assert.equal(usage?.totalTokens, 50);
  assert.equal(usage?.promptTokens, 40);
  assert.equal(usage?.completionTokens, 10);
});

test("extractProviderUsage accepts Ollama-style counts", () => {
  const usage = extractProviderUsage({
    prompt_eval_count: 12,
    eval_count: 8,
  });
  assert.equal(usage?.totalTokens, 20);
});

test("extractProviderUsage accepts nested usage object via root", () => {
  const usage = extractProviderUsage({
    usage: { promptTokens: 3, completionTokens: 7, totalTokens: 10 },
  });
  assert.equal(usage?.totalTokens, 10);
});

test("resolveRoundTokenUsage only accepts provider totals", () => {
  assert.equal(resolveRoundTokenUsage({ totalTokens: 99 }).source, "provider");
  assert.equal(resolveRoundTokenUsage({ totalTokens: 99 }).tokens, 99);
  assert.equal(resolveRoundTokenUsage(undefined).source, "unknown");
  assert.equal(resolveRoundTokenUsage(undefined).tokens, 0);
});

test("formatProviderTokenLine includes breakdown when available", () => {
  const line = formatProviderTokenLine({
    tokens: 150,
    promptTokens: 100,
    completionTokens: 50,
    source: "provider",
  });
  assert.match(line, /150/);
  assert.match(line, /in 100/);
  assert.match(line, /out 50/);
  assert.match(line, /provider/);
});
