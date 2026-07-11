import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";

import { DashboardServer } from "../../dist/dashboard-server.js";
import { MetricsCollector } from "../../dist/metrics/collector.js";
import { MissionManager } from "../../dist/mission/manager.js";
import { WorkflowRuntime } from "../../dist/workflow-runtime.js";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

test("dashboard workbench renders tasks, filters and responsive detail", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-dashboard-e2e-"));
  const port = await freePort();
  const manager = new MissionManager(stateDir);
  await manager.init();
  const running = await manager.createMission("扫描依赖边界", "检查模块关系并输出可执行修复建议", "session-e2e");
  await manager.updateStatus(running.id, "running");
  await manager.appendLog(running.id, "已读取 42 个模块");
  const failed = await manager.createMission("验证发布包", "检查 npm tarball 内容", "session-e2e");
  await manager.updateStatus(failed.id, "failed", { code: "PACK_FAILED", message: "缺少 README" });

  const collector = new MetricsCollector(join(stateDir, "metrics"), "session-e2e");
  await collector.init();
  collector.record({ type: "tool_call", data: { toolName: "read", path: "package.json" } });
  const workflow = new WorkflowRuntime(join(stateDir, "workflows"));
  await workflow.init();
  const agent = Object.assign(new EventEmitter(), {
    turnCount: 3,
    getMissionManager: () => manager,
    getRuntimeRootDir: () => stateDir,
    getSessionId: () => "session-e2e",
    getPermissionMode: () => "allow",
  });
  const dashboard = new DashboardServer({ port, collector, workflowRuntime: workflow, agentLoop: agent });
  const browser = await chromium.launch({ headless: true });

  try {
    await dashboard.start();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
    await page.getByText("扫描依赖边界", { exact: true }).waitFor();
    assert.equal(await page.getByText("加载中...", { exact: true }).count(), 0);
    assert.equal(await page.locator(".task-row").count(), 2);

    await page.getByText("扫描依赖边界", { exact: true }).click();
    await page.locator(".detail-title").filter({ hasText: "扫描依赖边界" }).waitFor();
    await page.getByRole("button", { name: "仅失败" }).click();
    assert.equal(await page.locator(".task-row").count(), 1);
    await page.locator(".task-row").filter({ hasText: "验证发布包" }).click();
    await page.getByText("缺少 README", { exact: false }).waitFor();
    await page.getByRole("button", { name: "关闭" }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".task-row").filter({ hasText: "验证发布包" }).click();
    await page.locator("#detail-pane.open").waitFor();
    await page.getByRole("button", { name: "关闭" }).click();
    await page.waitForFunction(() => !document.querySelector("#detail-pane")?.classList.contains("open"));
  } finally {
    await browser.close();
    dashboard.stop();
    await rm(stateDir, { recursive: true, force: true });
  }
});
