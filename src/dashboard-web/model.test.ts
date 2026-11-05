import { expect, test } from "vitest";
import type { DashboardSnapshot, DashboardTask } from "../dashboard/types";
import {
  DEFAULT_FILTERS,
  filterTasks,
  findTask,
  hasActiveFilters,
  summaryMetrics,
  taskKey,
} from "./model";
import {
  isOverlayLayout,
  layoutModeForWidth,
} from "./useDashboardLayout";
import { nextPollDelay } from "./hooks/useDashboardFeed";
import { taskActionButtonClass, taskActionSpec } from "./task-actions";
import { compactNumber, relativeTime } from "./format";
import { buildDashboardUrl, parseDashboardUrl } from "./dashboard-url";

const task = (overrides: Partial<DashboardTask> & Pick<DashboardTask, "id" | "kind" | "title">): DashboardTask => ({
  description: "",
  status: "running",
  rawStatus: "running",
  source: "local",
  createdAt: 1,
  updatedAt: 1,
  actions: [],
  ...overrides,
});

const TASKS = [
  task({ id: "one", kind: "mission", title: "扫描依赖边界", description: "检查模块关系", status: "running" }),
  task({ id: "two", kind: "mission", title: "验证发布包", description: "检查 npm tarball", status: "failed", sessionId: "session-release" }),
  task({ id: "three", kind: "loop", title: "轮询发布状态", status: "paused" }),
];

test("task filters combine kind, status and normalized search", () => {
  expect(filterTasks(TASKS, { ...DEFAULT_FILTERS, kind: "loop" }).map((item) => item.id)).toEqual(["three"]);
  expect(filterTasks(TASKS, { ...DEFAULT_FILTERS, status: "failed" }).map((item) => item.id)).toEqual(["two"]);
  expect(filterTasks(TASKS, { ...DEFAULT_FILTERS, status: "active" }).map((item) => item.id)).toEqual(["one", "three"]);
  expect(filterTasks(TASKS, { ...DEFAULT_FILTERS, search: "  RELEASE  " }).map((item) => item.id)).toEqual(["two"]);
  expect(hasActiveFilters({ ...DEFAULT_FILTERS, search: "  " })).toBe(false);
  expect(hasActiveFilters({ ...DEFAULT_FILTERS, status: "failed" })).toBe(true);
  expect(taskKey(TASKS[0])).toBe("mission:one");
});

test("task and summary selectors stay pure", () => {
  const snapshot = {
    summary: { total: 3, queued: 1, running: 1, blocked: 0, paused: 1, exhausted: 0, succeeded: 0, failed: 1, canceled: 0 },
    tasks: TASKS,
  } as unknown as DashboardSnapshot;
  expect(findTask(snapshot, "loop:three")?.title).toBe("轮询发布状态");
  expect(findTask(snapshot, "mission:missing")).toBeUndefined();
  expect(summaryMetrics(snapshot).map((metric) => metric.value)).toEqual([1, 2, 0, 1]);
});

test("layout modes match the CSS pivot points", () => {
  expect(layoutModeForWidth(1440)).toBe("wide");
  expect(layoutModeForWidth(1281)).toBe("wide");
  expect(layoutModeForWidth(1280)).toBe("medium");
  expect(layoutModeForWidth(1101)).toBe("medium");
  expect(layoutModeForWidth(1100)).toBe("condensed");
  expect(layoutModeForWidth(961)).toBe("condensed");
  expect(layoutModeForWidth(960)).toBe("compact");
  expect(layoutModeForWidth(721)).toBe("compact");
  expect(layoutModeForWidth(720)).toBe("narrow");
  expect(layoutModeForWidth(561)).toBe("narrow");
  expect(layoutModeForWidth(560)).toBe("phone");
  expect(layoutModeForWidth(320)).toBe("phone");
  expect(isOverlayLayout("compact")).toBe(true);
  expect(isOverlayLayout("condensed")).toBe(false);
});

test("polling backs off on failure and idle unchanged snapshots", () => {
  expect(nextPollDelay(0, 0)).toBe(3_000);
  expect(nextPollDelay(0, 3)).toBe(8_000);
  expect(nextPollDelay(1, 0)).toBe(6_000);
  expect(nextPollDelay(4, 0)).toBe(30_000);
});

test("session token counts stay compact while the full value remains available", () => {
  expect(compactNumber(999)).toBe("999");
  expect(compactNumber(1_000)).toBe("1 k");
  expect(compactNumber(267_573)).toBe("27 万");
  expect(compactNumber(67_487_041)).toBe("6749 万");
  expect(compactNumber(123_456_789)).toBe("1.2 亿");
  expect(compactNumber(Number.NaN)).toBe("—");
});

test("dashboard URLs validate input and preserve unrelated params", () => {
  const parsed = parseDashboardUrl("?kind=loop&status=failed&q=%E5%8F%91%E5%B8%83&task=mission%3Acheck%3Aone");
  expect(parsed).toEqual({
    filters: { kind: "loop", status: "failed", search: "发布" },
    selectedKey: "mission:check:one",
  });
  expect(parseDashboardUrl("?kind=unknown&status=nope&task=bad")).toEqual({
    filters: { kind: "all", status: "all", search: "" },
    selectedKey: null,
  });
  const built = buildDashboardUrl(
    { kind: "loop", status: "active", search: "发布 状态" },
    "mission:check:one",
    "http://127.0.0.1:9999/?keep=1#top"
  );
  const url = new URL(built, "http://127.0.0.1");
  expect(url.searchParams.get("keep")).toBe("1");
  expect(url.searchParams.get("kind")).toBe("loop");
  expect(url.searchParams.get("status")).toBe("active");
  expect(url.searchParams.get("q")).toBe("发布 状态");
  expect(url.searchParams.get("task")).toBe("mission:check:one");
  expect(url.hash).toBe("#top");
});

test("relative timestamps use the supplied clock", () => {
  const now = Date.UTC(2026, 10, 1, 12, 0, 0);
  expect(relativeTime(now - 12_000, now)).toBe("12 秒前");
  expect(relativeTime(now - 90_000, now)).toBe("1 分钟前");
  expect(relativeTime(now - 7_200_000, now)).toBe("2 小时前");
  expect(relativeTime(undefined, now)).toBe("—");
});

test("destructive actions carry confirmation policy in one registry", () => {
  expect(taskActionSpec("cancel").confirm?.confirmLabel).toBe("确认取消任务");
  expect(taskActionSpec("pause").confirm).toBeUndefined();
  expect(taskActionButtonClass("cancel")).toContain("button-danger");
  expect(taskActionButtonClass("retry")).toContain("button-primary");
});