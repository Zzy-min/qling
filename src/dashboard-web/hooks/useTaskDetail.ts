import { useCallback, useRef, useState } from "react";
import type { DashboardTask, DashboardTaskDetail } from "../../dashboard/types";
import { messageOf } from "../format";
import { taskKey } from "../model";

const REQUEST_TIMEOUT_MS = 10_000;

export type TaskDetailState =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; detail: DashboardTaskDetail }
  | { status: "error"; key: string; message: string };

export interface TaskDetailController {
  state: TaskDetailState;
  selectedKey: string | null;
  select: (task: DashboardTask, trigger?: HTMLButtonElement) => Promise<void>;
  close: (options?: { restoreFocus?: boolean }) => void;
  retry: () => Promise<void>;
  reload: (expectedKey?: string) => Promise<void>;
}

/**
 * A discriminated union prevents impossible combinations such as
 * "selected task exists, but loading and error are also true".
 */
export function useTaskDetail(): TaskDetailController {
  const [state, setState] = useState<TaskDetailState>({ status: "idle" });
  const target = useRef<DashboardTask | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const currentKey = useRef<string | null>(null);
  const requestId = useRef(0);
  const requestAbort = useRef<AbortController | null>(null);

  const load = useCallback(async (task: DashboardTask) => {
    const key = taskKey(task);
    const id = ++requestId.current;
    requestAbort.current?.abort();
    const controller = new AbortController();
    requestAbort.current = controller;
    currentKey.current = key;
    target.current = task;
    setState({ status: "loading", key });

    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(
        `/api/tasks/${encodeURIComponent(task.kind)}/${encodeURIComponent(task.id)}`,
        { signal: controller.signal }
      );
      if (id !== requestId.current) return;
      if (!response.ok) throw new Error(`详情请求失败 (${response.status})`);
      const detail = await response.json() as DashboardTaskDetail;
      if (id !== requestId.current) return;
      setState({ status: "ready", key, detail });
    } catch (cause) {
      if (id !== requestId.current) return;
      if (controller.signal.aborted && !timedOut) return;
      setState({
        status: "error",
        key,
        message: timedOut ? "任务详情请求超时" : messageOf(cause),
      });
    } finally {
      window.clearTimeout(timeout);
      if (requestAbort.current === controller) requestAbort.current = null;
    }
  }, []);

  const select = useCallback(async (task: DashboardTask, source?: HTMLButtonElement) => {
    if (source) trigger.current = source;
    await load(task);
  }, [load]);

  const close = useCallback((options?: { restoreFocus?: boolean }) => {
    const restoreFocus = options?.restoreFocus !== false;
    requestId.current += 1;
    requestAbort.current?.abort();
    requestAbort.current = null;
    currentKey.current = null;
    target.current = null;
    setState({ status: "idle" });
    if (!restoreFocus) return;
    const source = trigger.current;
    window.requestAnimationFrame(() => {
      if (source?.isConnected) source.focus();
    });
  }, []);

  const retry = useCallback(async () => {
    if (target.current) await load(target.current);
  }, [load]);

  const reload = useCallback(async (expectedKey?: string) => {
    if (!target.current) return;
    if (expectedKey && currentKey.current !== expectedKey) return;
    await load(target.current);
  }, [load]);

  return {
    state,
    selectedKey: state.status === "idle" ? null : state.key,
    select,
    close,
    retry,
    reload,
  };
}