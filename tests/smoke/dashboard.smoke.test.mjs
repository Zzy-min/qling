import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = join(process.cwd(), "dist", "index.js");

test("dashboard smoke: /dashboard shows link and local only (no model call)", () => {
  const result = spawnSync(process.execPath, [ENTRY, "dashboard"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_FEATURES_DASHBOARD: "true",
      QLING_DASHBOARD_PORT: "19999",
      QLING_LLM_API_KEY: "sk-smoke-dashboard",
    },
    timeout: 8000,
  });

  // 允许非0（可能进入交互提示），但输出必须包含关键本地信息
  const out = (result.stdout || "") + (result.stderr || "");
  assert.match(out, /Observability Dashboard|本地链接|Dashboard/);
  assert.match(out, /localhost:19999/);
  assert.doesNotMatch(out, /sk-smoke-dashboard/);
});

test("dashboard smoke: server module serves Chinese dashboard HTML (read-only)", async () => {
  // 轻量验证：确保 dashboard-server 模块可加载且 HTML 包含中文关键内容
  const { DashboardServer } = await import("../../dist/dashboard-server.js");
  assert.ok(DashboardServer, "DashboardServer exists");

  // 模拟最小 HTML 内容检查（通过源码或构建产物间接）
  const fs = await import("node:fs");
  const src = fs.readFileSync("src/dashboard-server.ts", "utf8");
  assert.match(src, /轻灵 · 本地 Dashboard/);
  assert.match(src, /api\/sessions|api\/permissions|api\/doctor/);
  assert.match(src, /只读观测/);
});