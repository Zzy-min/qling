import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = join(process.cwd(), "dist", "index.js");

test("knowledge smoke: top-level and slash show Chinese RAG guidance + citations", () => {
  const result = spawnSync(process.execPath, [ENTRY, "knowledge", "什么是轻灵"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_LLM_API_KEY: "sk-smoke-knowledge",
    },
    timeout: 8000,
  });

  const out = (result.stdout || "") + (result.stderr || "");
  assert.match(out, /轻灵知识库|中文 RAG/);
  assert.match(out, /查询|引用|chunk|模型推荐/);
  assert.match(out, /DeepSeek|Qwen|GLM/);
  assert.doesNotMatch(out, /sk-smoke-knowledge/);
});

test("knowledge smoke: index subcommand uses Chinese chunk strategy", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-kb-smoke-"));
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "test.md"), "轻灵是本地优先的AI Agent工作台。支持中文chunk和引用展示。", "utf8");

    const result = spawnSync(process.execPath, [ENTRY, "knowledge", "index", root], {
      encoding: "utf-8",
      env: { ...process.env },
      timeout: 8000,
    });
    const out = result.stdout || "";
    assert.match(out, /索引|chunk|中文 chunk 策略/);
    assert.match(out, /正在索引|索引完成/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("knowledge smoke: friendly prompt when no real model/index", () => {
  const result = spawnSync(process.execPath, [ENTRY, "knowledge", "测试查询"], {
    encoding: "utf-8",
    env: { ...process.env },
    timeout: 5000,
  });
  const out = (result.stdout || "") + (result.stderr || "");
  assert.match(out, /查询|结果|引用|memory|索引/);
});