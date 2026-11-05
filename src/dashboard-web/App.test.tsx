import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./App";
import type { DashboardSnapshot } from "../dashboard/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1024 });
  window.history.replaceState(null, "", "/");
});

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
  expect(screen.getByRole("button", { name: /验证发布包/ })).toHaveAttribute("tabindex", "0");
  await user.click(screen.getByText("验证发布包"));
  await waitFor(() => expect(screen.getByRole("complementary", { name: "任务详情" })).toHaveClass("open"));
  expect(await screen.findByText(/缺少 README/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
});

test("a slow previous task response cannot replace the selected task detail", async () => {
  let finishFirst!: (value: Response) => void;
  const first = new Promise<Response>(resolve => { finishFirst = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/one")) return first;
    if (String(input).endsWith("/two")) return new Response(JSON.stringify({ task: snapshot.tasks[1], detail: {}, events: [] }));
    return new Response(JSON.stringify(snapshot));
  }));
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByText("扫描依赖边界"));
  await user.click(screen.getByText("验证发布包"));
  const pane = screen.getByRole("complementary", { name: "任务详情" });
  await within(pane).findByText("验证发布包");
  await act(async () => { finishFirst(new Response(JSON.stringify({ task: snapshot.tasks[0], detail: {}, events: [] }))); await first; });
  expect(within(pane).getByText("验证发布包")).toBeInTheDocument();
  expect(within(pane).queryByText("扫描依赖边界")).not.toBeInTheDocument();
});

test("a snapshot failure stays visible and can be retried", async () => {
  let attempts = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    attempts++;
    return attempts === 1
      ? new Response(JSON.stringify({ message: "offline" }), { status: 503 })
      : new Response(JSON.stringify(snapshot), { status: 200 });
  }));
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByText("无法连接本地运行时")).toBeInTheDocument();
  expect(screen.getByText("快照请求失败 (503)")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重新连接" }));
  expect(await screen.findByText("扫描依赖边界")).toBeInTheDocument();
  expect(screen.queryByText("无法连接本地运行时")).not.toBeInTheDocument();
});

test("filtered empty state resets all filters and keyboard navigation follows visible rows", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(snapshot), { status: 200 })));
  const user = userEvent.setup();
  render(<App />);
  const first = await screen.findByRole("button", { name: /扫描依赖边界/ });
  expect(first).toHaveAttribute("tabindex", "0");
  const second = screen.getByRole("button", { name: /验证发布包/ });
  expect(second).toHaveAttribute("tabindex", "-1");
  first.focus();
  await user.keyboard("{ArrowDown}");
  expect(second).toHaveFocus();
  expect(second).toHaveAttribute("tabindex", "0");
  expect(first).toHaveAttribute("tabindex", "-1");
  await user.keyboard("/");
  const search = screen.getByRole("searchbox", { name: "搜索任务" });
  expect(search).toHaveFocus();
  await user.type(search, "不存在的任务");
  expect(await screen.findByText("没有匹配的任务")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "清除搜索" }));
  expect(search).toHaveValue("");
  expect(search).toHaveFocus();
  await user.type(search, "再次筛选");
  expect(await screen.findByText("没有匹配的任务")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "清除筛选" }));
  expect(await screen.findByText("扫描依赖边界")).toBeInTheDocument();
  expect(search).toHaveValue("");
});

test("a detail failure offers an inline retry without losing selection", async () => {
  let detailAttempts = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/tasks/")) {
      detailAttempts++;
      return detailAttempts === 1
        ? new Response(JSON.stringify({ message: "offline" }), { status: 503 })
        : new Response(JSON.stringify({ task: snapshot.tasks[0], detail: {}, events: [] }), { status: 200 });
    }
    return new Response(JSON.stringify(snapshot), { status: 200 });
  }));
  const user = userEvent.setup();
  render(<App />);
  const trigger = await screen.findByRole("button", { name: /扫描依赖边界/ });
  await user.click(trigger);
  expect(await screen.findByText("任务详情读取失败")).toBeInTheDocument();
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  await user.click(screen.getByRole("button", { name: "重试" }));
  const pane = screen.getByRole("complementary", { name: "任务详情" });
  expect(await within(pane).findByText("扫描依赖边界")).toBeInTheDocument();
});

test("compact detail behaves as a modal and returns focus to its trigger", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 800 });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/tasks/")) {
      return new Response(JSON.stringify({ task: { ...snapshot.tasks[0], actions: ["pause", "cancel"] }, detail: {}, events: [] }), { status: 200 });
    }
    return new Response(JSON.stringify(snapshot), { status: 200 });
  }));
  const user = userEvent.setup();
  render(<App />);
  const trigger = await screen.findByRole("button", { name: /扫描依赖边界/ });
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "任务详情" });
  expect(document.querySelector(".app-band")).toHaveAttribute("inert");
  expect(document.querySelector(".workbench-background")).toHaveAttribute("inert");
  const close = within(dialog).getByRole("button", { name: "关闭" });
  await waitFor(() => expect(close).toHaveFocus());
  expect(document.body).toHaveStyle({ overflow: "hidden" });
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  const confirmation = within(dialog).getByRole("group", { name: "取消任务确认" });
  const back = within(confirmation).getByRole("button", { name: "返回" });
  await waitFor(() => expect(back).toHaveFocus());
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("group", { name: "取消任务确认" })).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "任务详情" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "任务详情" })).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(document.body).toHaveStyle({ overflow: "" });
  expect(document.querySelector(".app-band")).not.toHaveAttribute("inert");
  expect(document.querySelector(".workbench-background")).not.toHaveAttribute("inert");
});

test("session restore commands can be copied from the rail", async () => {
  const user = userEvent.setup();
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText } });
  const withSessions: DashboardSnapshot = {
    ...snapshot,
    sessions: [{
      sessionId: "session-test",
      name: "发布前可靠性检查",
      updatedAt: new Date().toISOString(),
      turnCount: 12,
      messageCount: 28,
      sessionTokens: 18420,
      active: true,
      resumeCommand: "qling --resume session-test",
    }],
  };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(withSessions), { status: 200 })));
  render(<App />);
  await screen.findByText("发布前可靠性检查");
  await user.click(screen.getByRole("button", { name: /复制 发布前可靠性检查/ }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("qling --resume session-test"));
  expect(await screen.findByText("已复制会话恢复命令")).toBeInTheDocument();
});

test("a shared URL restores filters and the selected task", async () => {
  window.history.replaceState(null, "", "/?kind=mission&status=failed&q=%E5%8F%91%E5%B8%83&task=mission%3Atwo");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/tasks/")) {
      return new Response(JSON.stringify({ task: snapshot.tasks[1], detail: {}, events: [] }), { status: 200 });
    }
    return new Response(JSON.stringify(snapshot), { status: 200 });
  }));
  const user = userEvent.setup();
  render(<App />);
  expect(screen.getByRole("searchbox", { name: "搜索任务" })).toHaveValue("发布");
  expect(screen.getByRole("button", { name: "Mission" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "仅失败" })).toHaveAttribute("aria-pressed", "true");
  const pane = screen.getByRole("complementary", { name: "任务详情" });
  expect(await within(pane).findByText("验证发布包")).toBeInTheDocument();
  const params = new URLSearchParams(window.location.search);
  expect(params.get("task")).toBe("mission:two");
  expect(params.get("kind")).toBe("mission");
  expect(params.get("status")).toBe("failed");
  await user.click(within(pane).getByRole("button", { name: "关闭" }));
  expect(new URLSearchParams(window.location.search).get("task")).toBeNull();
});

test("filter and task selection are reflected in the URL", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/tasks/")) {
      return new Response(JSON.stringify({ task: snapshot.tasks[1], detail: {}, events: [] }), { status: 200 });
    }
    return new Response(JSON.stringify(snapshot), { status: 200 });
  }));
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "仅失败" }));
  await user.click(screen.getByRole("button", { name: /验证发布包/ }));
  const pane = screen.getByRole("complementary", { name: "任务详情" });
  await within(pane).findByText("验证发布包");
  const params = new URLSearchParams(window.location.search);
  expect(params.get("status")).toBe("failed");
  expect(params.get("task")).toBe("mission:two");
});

test("popstate restores filters without reloading the page", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(snapshot), { status: 200 })));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("扫描依赖边界");
  act(() => {
    window.history.replaceState(null, "", "/?status=failed");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(screen.getByRole("button", { name: "仅失败" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByText("扫描依赖边界")).not.toBeInTheDocument();
  expect(screen.getByText("验证发布包")).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get("status")).toBe("failed");
});

test("cancel requires explicit confirmation before posting the action", async () => {
  const cancelableTask = { ...snapshot.tasks[0], actions: ["cancel"] };
  let cancelPosted = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/cancel") && init?.method === "POST") {
      cancelPosted = true;
      return new Response(JSON.stringify({ message: "任务已取消" }), { status: 200 });
    }
    if (url.includes("/api/tasks/")) {
      return new Response(JSON.stringify({ task: cancelableTask, detail: {}, events: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ ...snapshot, tasks: [cancelableTask] }), { status: 200 });
  }));
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: /扫描依赖边界/ }));
  const pane = screen.getByRole("complementary", { name: "任务详情" });
  await within(pane).findByText("扫描依赖边界");
  await user.click(within(pane).getByRole("button", { name: "取消" }));
  expect(cancelPosted).toBe(false);
  expect(within(pane).getByRole("group", { name: "取消任务确认" })).toBeInTheDocument();
  await user.click(within(pane).getByRole("button", { name: "返回" }));
  expect(within(pane).queryByRole("group", { name: "取消任务确认" })).not.toBeInTheDocument();
  expect(cancelPosted).toBe(false);
  await user.click(within(pane).getByRole("button", { name: "取消" }));
  await user.click(within(pane).getByRole("button", { name: "确认取消任务" }));
  await waitFor(() => expect(cancelPosted).toBe(true));
});
