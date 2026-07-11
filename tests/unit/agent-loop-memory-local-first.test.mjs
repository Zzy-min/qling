import test from "node:test";
import assert from "node:assert/strict";
import { resolveMemoryDreamLlmEnabled } from "../../dist/agent-loop.js";

test("memory dream LLM is disabled unless explicitly enabled", () => {
  assert.equal(resolveMemoryDreamLlmEnabled({}), false);
  assert.equal(resolveMemoryDreamLlmEnabled({ QLING_MEMORY_DREAM_LLM_ENABLED: "false" }), false);
  assert.equal(resolveMemoryDreamLlmEnabled({ QLING_MEMORY_DREAM_LLM_ENABLED: "0" }), false);
  assert.equal(resolveMemoryDreamLlmEnabled({ QLING_MEMORY_DREAM_LLM_ENABLED: "true" }), true);
  assert.equal(resolveMemoryDreamLlmEnabled({ QLING_MEMORY_DREAM_LLM_ENABLED: "1" }), true);
  assert.equal(resolveMemoryDreamLlmEnabled({ QLING_MEMORY_DREAM_LLM_ENABLED: "ON" }), true);
  assert.equal(resolveMemoryDreamLlmEnabled({ QLING_MEMORY_DREAM_LLM_ENABLED: "yes" }), true);
});
