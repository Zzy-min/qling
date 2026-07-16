import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = join(process.cwd(), "dist", "index.js");

test("dashboard smoke: /dashboard shows link and local only (no model call)", () => {
  const result = spawnSync(process.execPath, [ENTRY, "dashboard", "start"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_FEATURES_DASHBOARD: "true",
      QLING_DASHBOARD_PORT: "19999",
      QLING_LLM_API_KEY: "sk-smoke-dashboard",
    },
    // 启动含 metrics/discovery；keep-alive 会被 timeout 打断
    timeout: 20_000,
    killSignal: "SIGTERM",
  });

  // 允许非0（timeout 杀进程），但输出必须包含关键本地信息
  const out = (result.stdout || "") + (result.stderr || "");
  assert.match(out, /任务工作台|Mission Control|本地链接|Dashboard/);
  assert.match(out, /127\.0\.0\.1:19999/);
  assert.doesNotMatch(out, /sk-smoke-dashboard/);
});

test("dashboard smoke: page and client are separate typed assets", async () => {
  const { DashboardServer } = await import("../../dist/dashboard-server.js");
  const { DASHBOARD_HTML } = await import("../../dist/dashboard/page.js");
  assert.ok(DashboardServer, "DashboardServer exists");
  assert.match(DASHBOARD_HTML, /轻灵任务工作台/);
  assert.match(DASHBOARD_HTML, /MISSION CONTROL|最近会话/);
  assert.match(DASHBOARD_HTML, /assets\/dashboard\.js/);
  assert.doesNotMatch(DASHBOARD_HTML, /sess:\s*any/);
});
