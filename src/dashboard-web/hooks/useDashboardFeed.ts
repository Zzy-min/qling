import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type { DashboardSnapshot } from "../../dashboard/types";
import { messageOf } from "../format";

const BASE_POLL_MS = 3_000;
const IDLE_POLL_MS = 8_000;
const MAX_BACKOFF_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface DashboardFeed {
  snapshot: DashboardSnapshot | null;
  error: string;
  refreshing: boolean;
  refresh: (force?: boolean) => Promise<boolean>;
  manualRefresh: () => Promise<void>;
}

export function nextPollDelay(failures: number, unchanged: number): number {
  if (failures > 0) return Math.min(MAX_BACKOFF_MS, BASE_POLL_MS * 2 ** Math.min(failures, 4));
  return unchanged >= 3 ? IDLE_POLL_MS : BASE_POLL_MS;
}

/**
 * Snapshot transport only. It deliberately does not know about filters,
 * selection or rendered task rows.
 */
export function useDashboardFeed(): DashboardFeed {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const etag = useRef("");
  const failures = useRef(0);
  const unchanged = useRef(0);
  const requestId = useRef(0);
  const requestAbort = useRef<AbortController | null>(null);

  const refresh = useCallback(async (force = false): Promise<boolean> => {
    const id = ++requestId.current;
    requestAbort.current?.abort();
    const controller = new AbortController();
    requestAbort.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const headers: HeadersInit = {};
      if (etag.current && !force) headers["If-None-Match"] = etag.current;
      const response = await fetch("/api/dashboard/snapshot", { headers, signal: controller.signal });
      if (id !== requestId.current) return false;
      if (response.status === 304) {
        failures.current = 0;
        unchanged.current += 1;
        setError("");
        return false;
      }
      if (!response.ok) throw new Error(`快照请求失败 (${response.status})`);
      const body = await response.json() as DashboardSnapshot;
      if (id !== requestId.current) return false;
      etag.current = response.headers.get("etag") ?? "";
      failures.current = 0;
      unchanged.current = 0;
      startTransition(() => setSnapshot(body));
      setError("");
      return true;
    } catch (cause) {
      if (id !== requestId.current) return false;
      if (controller.signal.aborted && !timedOut) return false;
      failures.current += 1;
      const message = timedOut ? "快照请求超时，请检查本地运行时" : messageOf(cause);
      setError(message);
      throw timedOut ? new Error(message) : cause;
    } finally {
      window.clearTimeout(timeout);
      if (requestAbort.current === controller) requestAbort.current = null;
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    let polling = false;

    const loop = async () => {
      if (disposed || polling || document.hidden) return;
      polling = true;
      try {
        await refresh();
      } catch {
        // Errors are persisted in feed state; polling must keep retrying with backoff.
      } finally {
        polling = false;
      }
      if (disposed || document.hidden) return;
      timer = window.setTimeout(() => void loop(), nextPollDelay(failures.current, unchanged.current));
    };

    const onVisibility = () => {
      window.clearTimeout(timer);
      if (!document.hidden) void loop();
    };

    void loop();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      requestId.current += 1;
      requestAbort.current?.abort();
    };
  }, [refresh]);

  const manualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh(true);
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  return { snapshot, error, refreshing, refresh, manualRefresh };
}