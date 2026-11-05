import type {
  DashboardSnapshot,
  DashboardTask,
  DashboardTaskKind,
  DashboardTaskStatus,
} from "../dashboard/types";

export const ACTIVE_STATUSES = new Set<DashboardTaskStatus>(["running", "blocked", "queued", "paused"]);

export interface DashboardFilters {
  kind: DashboardTaskKind | "all";
  status: "all" | "active" | "failed";
  search: string;
}

export const DEFAULT_FILTERS: DashboardFilters = { kind: "all", status: "all", search: "" };

export const KIND_FILTERS: ReadonlyArray<readonly [DashboardFilters["kind"], string]> = [
  ["all", "全部类型"],
  ["mission", "Mission"],
  ["loop", "Loop"],
  ["workflow", "Workflow"],
];

export const STATUS_FILTERS: ReadonlyArray<readonly [DashboardFilters["status"], string]> = [
  ["active", "进行中"],
  ["failed", "仅失败"],
  ["all", "全部状态"],
];

export function taskKey(task: Pick<DashboardTask, "id" | "kind">): string {
  return `${task.kind}:${task.id}`;
}

export function matchesTaskKey(task: Pick<DashboardTask, "id" | "kind">, key: string | null): boolean {
  return key === taskKey(task);
}

export function hasActiveFilters(filters: DashboardFilters): boolean {
  return filters.kind !== "all" || filters.status !== "all" || filters.search.trim().length > 0;
}

export function filterTasks(tasks: readonly DashboardTask[], filters: DashboardFilters): DashboardTask[] {
  const query = filters.search.trim().toLocaleLowerCase("zh-CN");
  return tasks.filter((task) => {
    if (filters.kind !== "all" && task.kind !== filters.kind) return false;
    if (filters.status === "active" && !ACTIVE_STATUSES.has(task.status)) return false;
    if (filters.status === "failed" && task.status !== "failed") return false;
    if (!query) return true;
    return `${task.title} ${task.description} ${task.id} ${task.sessionId ?? ""}`
      .toLocaleLowerCase("zh-CN")
      .includes(query);
  });
}

export interface SummaryMetric {
  key: "running" | "waiting" | "blocked" | "failed";
  label: string;
  value: number | undefined;
}

export function summaryMetrics(snapshot: DashboardSnapshot | null): SummaryMetric[] {
  const summary = snapshot?.summary;
  return [
    { key: "running", label: "运行", value: summary?.running },
    { key: "waiting", label: "等待", value: summary ? summary.queued + summary.paused : undefined },
    { key: "blocked", label: "阻塞", value: summary?.blocked },
    { key: "failed", label: "失败", value: summary?.failed },
  ];
}

export function findTask(snapshot: DashboardSnapshot | null, key: string | null): DashboardTask | undefined {
  if (!key) return undefined;
  return snapshot?.tasks.find((task) => matchesTaskKey(task, key));
}