import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  DashboardSessionSummary,
  DashboardTask,
  DashboardTaskAction,
} from "../dashboard/types";
import { messageOf } from "./format";
import { useDashboardFeed } from "./hooks/useDashboardFeed";
import { useDashboardKeyboard } from "./hooks/useDashboardKeyboard";
import { useDashboardUrlState } from "./hooks/useDashboardUrlState";
import { useTaskDetail } from "./hooks/useTaskDetail";
import {
  findTask,
  filterTasks,
  hasActiveFilters,
  taskKey,
  type DashboardFilters,
} from "./model";
import { actionPendingKey } from "./task-actions";
import { useDashboardLayout } from "./useDashboardLayout";
import { ActivityPanel } from "./ui/ActivityPanel";
import { DetailPane } from "./ui/DetailPane";
import { DashboardHeader, SummaryStrip, TrustLine } from "./ui/Header";
import { Icon } from "./ui/Icon";
import { SessionRail } from "./ui/SessionRail";
import { TaskExplorer } from "./ui/TaskExplorer";
import { Toast, type Notice } from "./ui/Toast";

function DotGrid() {
  return <div className="dot-grid" aria-hidden="true" />;
}

export function App() {
  return (
    <LazyMotion features={domAnimation} strict>
      <DashboardApp />
    </LazyMotion>
  );
}

function DashboardApp() {
  const reducedMotion = useReducedMotion();
  const shellRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const layout = useDashboardLayout(shellRef);
  const {
    snapshot,
    error: snapshotError,
    refreshing,
    refresh,
    manualRefresh,
  } = useDashboardFeed();
  const detail = useTaskDetail();

  const closeDetail = useCallback(
    () => detail.close(),
    [detail.close]
  );
  const { filters, setFilters, resetFilters } = useDashboardUrlState({
    snapshot,
    selectedKey: detail.selectedKey,
    selectTask: detail.select,
    closeDetail: detail.close,
  });

  const [notice, setNotice] = useState<Notice | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);

  const deferredSearch = useDeferredValue(filters.search);
  const effectiveFilters = useMemo<DashboardFilters>(
    () => ({ ...filters, search: deferredSearch }),
    [deferredSearch, filters.kind, filters.status]
  );
  const tasks = useMemo(
    () => filterTasks(snapshot?.tasks ?? [], effectiveFilters),
    [effectiveFilters, snapshot?.tasks]
  );
  const hasFilters = hasActiveFilters(filters);

  const notify = useCallback(
    (message: string, kind: Notice["kind"] = "status") => setNotice({ message, kind }),
    []
  );
  const dismissNotice = useCallback(() => setNotice(null), []);

  const changeFilters = useCallback((next: DashboardFilters) => setFilters(next), [setFilters]);
  const clearSearch = useCallback(
    () => setFilters((current) => ({ ...current, search: "" })),
    [setFilters]
  );

  useEffect(() => {
    if (detail.selectedKey && snapshot && !findTask(snapshot, detail.selectedKey)) {
      detail.close({ restoreFocus: false });
    }
  }, [detail.close, detail.selectedKey, snapshot]);

  const refreshWithNotice = useCallback(async () => {
    try {
      await manualRefresh();
      notify("任务数据已刷新");
    } catch {
      // The persistent sync warning is the retry surface; do not duplicate it as a toast.
    }
  }, [manualRefresh, notify]);

  useDashboardKeyboard({
    searchRef,
    detailOpen: detail.state.status !== "idle",
    search: filters.search,
    hasFilters,
    onCloseDetail: closeDetail,
    onClearSearch: clearSearch,
    onResetFilters: resetFilters,
  });

  const copySessionCommand = useCallback(async (session: DashboardSessionSummary) => {
    const command = session.resumeCommand;
    if (!command) {
      notify("该会话没有可复制的恢复命令", "error");
      return;
    }
    try {
      const clipboard = window.navigator.clipboard;
      if (!clipboard?.writeText) {
        throw new Error("当前浏览器不支持剪贴板访问，请手动选择命令");
      }
      await clipboard.writeText(command);
      notify("已复制会话恢复命令");
    } catch (cause) {
      notify(`复制失败：${messageOf(cause)}`, "error");
    }
  }, [notify]);

  const selectTask = useCallback(
    async (task: DashboardTask, trigger: HTMLButtonElement) => {
      await detail.select(task, trigger);
    },
    [detail.select]
  );

  const runAction = useCallback(
    async (task: DashboardTask, action: DashboardTaskAction) => {
      setActionPending(actionPendingKey(task, action));
      try {
        const response = await fetch(
          `/api/tasks/${encodeURIComponent(task.kind)}/${encodeURIComponent(task.id)}/${action}`,
          { method: "POST" }
        );
        const body = await response.json() as { message?: string };
        if (!response.ok) throw new Error(body.message ?? `操作失败 (${response.status})`);
        notify(body.message ?? "操作已完成");
        await refresh(true).catch(() => undefined);
        await detail.reload(taskKey(task));
      } catch (cause) {
        notify(messageOf(cause), "error");
      } finally {
        setActionPending(null);
      }
    },
    [detail.reload, notify, refresh]
  );

  const overlayOpen = layout.overlayDetail && detail.state.status !== "idle";
  const backgroundInert = overlayOpen || undefined;

  return (
    <main ref={shellRef} className="app-shell" data-layout={layout.mode}>
      {!reducedMotion && <DotGrid />}
      <m.div
        className="app-content"
        initial={reducedMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: .42, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="app-band" inert={backgroundInert}>
          <a className="skip-link" href="#task-search">跳到任务搜索</a>
          <DashboardHeader
            snapshot={snapshot}
            snapshotError={snapshotError}
            refreshing={refreshing}
            onRefresh={refreshWithNotice}
          />
          <TrustLine snapshot={snapshot} />
          <SummaryStrip snapshot={snapshot} />
        </div>

        <div className="workbench" data-detail={detail.state.status === "idle" ? "empty" : "open"}>
          <div className="workbench-background" inert={backgroundInert}>
            <SessionRail
              sessions={snapshot?.sessions ?? []}
              onCopy={(session) => void copySessionCommand(session)}
            />
            <TaskExplorer
              tasks={tasks}
              selectedKey={detail.selectedKey}
              hasSnapshot={Boolean(snapshot)}
              snapshotError={snapshotError}
              refreshing={refreshing}
              filters={filters}
              searchRef={searchRef}
              onFiltersChange={changeFilters}
              onResetFilters={resetFilters}
              onSelectTask={(task, trigger) => void selectTask(task, trigger)}
              onRefresh={refreshWithNotice}
            />
          </div>

          <AnimatePresence>
            {overlayOpen && (
              <m.button
                className="detail-backdrop"
                type="button"
                aria-label="关闭任务详情"
                tabIndex={-1}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeDetail}
              />
            )}
          </AnimatePresence>

          <DetailPane
            state={detail.state}
            overlay={layout.overlayDetail}
            actionPending={actionPending}
            onClose={closeDetail}
            onAction={runAction}
            onRetry={() => void detail.retry()}
          />
        </div>

        <div className="app-band" inert={backgroundInert}>
          <ActivityPanel snapshot={snapshot} />
          <footer>
            <span>LOCAL-FIRST / NO TELEMETRY</span>
            <span>任务数据留在当前设备</span>
            <span>QLING MISSION CONTROL</span>
          </footer>
        </div>
      </m.div>

      <AnimatePresence>
        {notice && <Toast notice={notice} onClose={dismissNotice} />}
      </AnimatePresence>
    </main>
  );
}