import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DashboardSnapshot, DashboardTask } from "../../dashboard/types";
import {
  buildDashboardUrl,
  currentDashboardLocation,
  parseDashboardUrl,
} from "../dashboard-url";
import { DEFAULT_FILTERS, findTask, type DashboardFilters } from "../model";

interface UrlStateOptions {
  snapshot: DashboardSnapshot | null;
  selectedKey: string | null;
  selectTask: (task: DashboardTask, trigger?: HTMLButtonElement) => Promise<void>;
  closeDetail: (options?: { restoreFocus?: boolean }) => void;
}

export interface DashboardUrlState {
  filters: DashboardFilters;
  setFilters: Dispatch<SetStateAction<DashboardFilters>>;
  resetFilters: () => void;
}

/**
 * Filters and the selected task are view state, so they belong in the URL.
 * `replaceState` keeps typing and polling out of browser history while still
 * making refresh, deep links and back/forward restore the view.
 */
export function useDashboardUrlState({
  snapshot,
  selectedKey,
  selectTask,
  closeDetail,
}: UrlStateOptions): DashboardUrlState {
  const [initial] = useState(() => parseDashboardUrl(window.location.search));
  const [filters, setFiltersState] = useState<DashboardFilters>(initial.filters);
  const [ready, setReady] = useState(initial.selectedKey === null);
  const snapshotRef = useRef(snapshot);
  const selectedRef = useRef(selectedKey);
  const selectRef = useRef(selectTask);
  snapshotRef.current = snapshot;
  selectedRef.current = selectedKey;
  selectRef.current = selectTask;

  useEffect(() => {
    if (ready) return;
    if (!snapshot) return;
    const task = findTask(snapshot, initial.selectedKey);
    if (task) void selectTask(task);
    setReady(true);
  }, [initial.selectedKey, ready, selectTask, snapshot]);

  useEffect(() => {
    if (!ready) return;
    const next = buildDashboardUrl(filters, selectedKey, currentDashboardLocation());
    if (next !== currentDashboardLocation()) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [filters, ready, selectedKey]);

  useEffect(() => {
    const onPopState = () => {
      const next = parseDashboardUrl(window.location.search);
      setFiltersState(next.filters);
      setReady(true);
      if (!next.selectedKey) {
        if (selectedRef.current) closeDetail({ restoreFocus: false });
        return;
      }
      if (next.selectedKey === selectedRef.current) return;
      const task = findTask(snapshotRef.current, next.selectedKey);
      if (task) void selectRef.current(task);
      else if (selectedRef.current) closeDetail({ restoreFocus: false });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [closeDetail]);

  const setFilters = useCallback(
    (next: SetStateAction<DashboardFilters>) => setFiltersState(next),
    []
  );
  const resetFilters = useCallback(() => setFiltersState(DEFAULT_FILTERS), []);

  return { filters, setFilters, resetFilters };
}