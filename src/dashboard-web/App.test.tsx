import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { App } from "./App";
import type { DashboardSnapshot } from "../dashboard/types";

const snapshot: DashboardSnapshot = {
  generatedAt: Date.now(),
  revision: "test",
  runtime: { ready: true, sessionId: "session-test", daemonHealthy: false, daemonSource: "local", permissionMode: "ask" },
  summary: { total: 2, queued: 0, running: 1, blocked: 0, paused: 0, exhausted: 0, succeeded: 0, failed: 1, canceled: 0 },
  tasks: [
    { id: "one", kind: "mission", title: "扫描依赖边界", description: "检查模块关系", status: "running", rawStatus: "running", source: "local", createdAt: Date.now(), updatedAt: Date.now(), actions: ["pause"] },
    { id: "two", kind: "mission", title: "验证发布包", description: "检查 npm tarball", status: "failed", rawStatus: "failed", source: "local", createdAt: Date.now(), updatedAt: Date.now(), error: { message: "缺少 README" }, actions: ["retry"] },
  ],
  sessions: [],
  activity: [],
  boundary: { localOnly: true, activityTruncated: false, activityScannedBytes: 0 },
};

test("filters failed tasks and opens accessible detail", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/tasks/")) {
      return new Response(JSON.stringify({ task: snapshot.tasks[1], detail: {}, events: [] }), { status: 200 });
    }
    return new Response(JSON.stringify(snapshot), { status: 200, headers: { etag: "test" } });
  }));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("扫描依赖边界");
  await user.click(screen.getByRole("button", { name: "仅失败" }));
  expect(screen.queryByText("扫描依赖边界")).not.toBeInTheDocument();
  await user.click(screen.getByText("验证发布包"));
  await waitFor(() => expect(screen.getByRole("complementary", { name: "任务详情" })).toHaveClass("open"));
  expect(await screen.findByText(/缺少 README/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
});
