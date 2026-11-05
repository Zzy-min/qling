import type { DashboardTaskKind } from "../dashboard/types";
import { DEFAULT_FILTERS, type DashboardFilters } from "./model";

const TASK_KINDS = new Set<DashboardTaskKind>(["mission", "loop", "workflow"]);
const TASK_STATUSES = new Set<DashboardFilters["status"]>(["all", "active", "failed"]);
const TASK_KEY_PATTERN = /^(mission|loop|workflow):(.+)$/;

export interface DashboardUrlState {
  filters: DashboardFilters;
  selectedKey: string | null;
}

export function parseDashboardUrl(search: string): DashboardUrlState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const kind = params.get("kind");
  const status = params.get("status");
  const task = params.get("task");
  const match = task?.match(TASK_KEY_PATTERN);
  return {
    filters: {
      kind: kind && TASK_KINDS.has(kind as DashboardTaskKind)
        ? kind as DashboardTaskKind
        : DEFAULT_FILTERS.kind,
      status: status && TASK_STATUSES.has(status as DashboardFilters["status"])
        ? status as DashboardFilters["status"]
        : DEFAULT_FILTERS.status,
      search: params.get("q") ?? "",
    },
    selectedKey: match ? `${match[1]}:${match[2]}` : null,
  };
}

export function buildDashboardUrl(
  filters: DashboardFilters,
  selectedKey: string | null,
  currentHref: string
): string {
  const url = new URL(currentHref, "http://127.0.0.1");
  if (filters.kind === "all") url.searchParams.delete("kind");
  else url.searchParams.set("kind", filters.kind);
  if (filters.status === "all") url.searchParams.delete("status");
  else url.searchParams.set("status", filters.status);
  if (filters.search.trim()) url.searchParams.set("q", filters.search);
  else url.searchParams.delete("q");
  if (selectedKey) url.searchParams.set("task", selectedKey);
  else url.searchParams.delete("task");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function currentDashboardLocation(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}