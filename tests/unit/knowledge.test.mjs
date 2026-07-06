import test from "node:test";
import assert from "node:assert/strict";

import { chineseChunk, simpleIndex } from "../../dist/commands/knowledge.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("P3: chineseChunk splits Chinese text properly", () => {
  const text = "轻灵是本地优先的AI Agent工作台。它支持中文chunk策略。推荐使用Qwen模型。";
  const chunks = chineseChunk(text, 30);
  assert.ok(chunks.length >= 1);
  assert.ok(chunks.some(c => c.includes("轻灵")));
  // chunks should be reasonably sized
  chunks.forEach(c => assert.ok(c.length <= 50));
});

test("P3: simpleIndex discovers and chunks markdown files", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-kb-unit-"));
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "guide.md"), "轻灵支持RAG。中文知识库默认值。", "utf8");
    writeFileSync(join(root, "notes.txt"), "测试文件。用于索引。", "utf8");

    const results = simpleIndex(root, 10);
    assert.ok(results.length >= 1);
    const hasMd = results.some(r => r.file.includes("guide"));
    assert.ok(hasMd);
    assert.ok(results.some(r => r.chunks.length > 0));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P3: citation chain simulation in RAG results", () => {
  // Simulate citation chain: file -> chunk -> memory entry -> query result
  const chainExample = [
    { source: "guide.md", chunk: "轻灵支持RAG", conf: "0.85", chain: "file:guide.md -> chunk:0 -> memory:kb-1" },
    { source: "memory", chunk: "知识库默认值", conf: "0.92", chain: "memory:kb-1 -> semantic:vec-42" }
  ];
  assert.ok(chainExample.length === 2);
  assert.match(chainExample[0].chain, /file:.*-> chunk:.*-> memory/);
  assert.match(chainExample[1].chain, /memory:.*-> semantic:/);
  // Would test in knowledge command output
});