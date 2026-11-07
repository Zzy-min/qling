import { useEffect, useRef, useState } from "react";
import { m } from "motion/react";
import type { DashboardTask, DashboardTaskAction } from "../../dashboard/types";
import { dateTime, formatTime, kindLabel } from "../format";
import {
  actionPendingKey,
  taskActionButtonClass,
  taskActionSpec,
} from "../task-actions";
import type { TaskDetailState } from "../hooks/useTaskDetail";
import { EmptyState } from "./Feedback";
import { Icon } from "./Icon";
import { Status } from "./Status";

interface DetailPaneProps {
  state: TaskDetailState;
  overlay: boolean;
  actionPending: string | null;
  onClose: () => void;
  onAction: (task: DashboardTask, action: DashboardTaskAction) => Promise<void>;
  onRetry: () => void;
}

export function DetailPane({
  state,
  overlay,
  actionPending,
  onClose,
  onAction,
  onRetry,
}: DetailPaneProps) {
  const task = state.status === "ready" ? state.detail.task : undefined;
  const detail = state.status === "ready" ? state.detail : null;
  const loading = state.status === "loading";
  const error = state.status === "error" ? state.message : "";
  const open = state.status !== "idle";
  const stateKey = state.status === "idle" ? null : state.key;

  const paneRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const confirmBackRef = useRef<HTMLButtonElement>(null);
  const actionTriggers = useRef<Partial<Record<DashboardTaskAction, HTMLButtonElement | null>>>({});
  const [confirmAction, setConfirmAction] = useState<DashboardTaskAction | null>(null);
  const confirmation = confirmAction ? taskActionSpec(confirmAction).confirm : undefined;

  useEffect(() => {
    setConfirmAction(null);
  }, [stateKey]);

  useEffect(() => {
    if (!overlay || !open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, overlay]);

  useEffect(() => {
    if (confirmAction) confirmBackRef.current?.focus();
  }, [confirmAction]);

  const dismissConfirm = () => {
    const action = confirmAction;
    setConfirmAction(null);
    window.requestAnimationFrame(() => {
      if (action) actionTriggers.current[action]?.focus();
    });
  };

  const executeAction = (action: DashboardTaskAction) => {
    if (!task) return;
    setConfirmAction(null);
    void onAction(task, action);
  };

  const requestAction = (action: DashboardTaskAction) => {
    const spec = taskActionSpec(action);
    if (spec.confirm && confirmAction !== action) {
      setConfirmAction(action);
      return;
    }
    executeAction(action);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && confirmAction) {
      event.preventDefault();
      event.stopPropagation();
      dismissConfirm();
      return;
    }
    if (!overlay || !open || event.key !== "Tab") return;
    const focusable = Array.from(
      paneRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], input, [tabindex='0']"
      ) ?? []
    );
    if (!focusable.length) {
      event.preventDefault();
      paneRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <aside
      ref={paneRef}
      id="task-detail"
      className={`detail-pane${open ? " open" : ""}`}
      role={overlay && open ? "dialog" : "complementary"}
      aria-modal={overlay && open ? true : undefined}
      aria-label="任务详情"
      aria-describedby={task ? "detail-title" : undefined}
      aria-busy={loading}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {task && (
        <p className="sr-only" role="status">
          已打开任务详情：{task.title}
        </p>
      )}
      {open && (
        <button ref={closeRef} className="button button-ghost detail-close" type="button" onClick={onClose}>
          <Icon name="close" size={17} />
          <span>关闭</span>
        </button>
      )}

      {loading && !task ? (
        <div className="detail-loading" role="status">
          <span className="sr-only">正在读取任务详情</span>
          <i /><i /><i /><i />
        </div>
      ) : error && !task ? (
        <EmptyState
          error
          title="任务详情读取失败"
          description={error}
          actionLabel="重试"
          onAction={onRetry}
        />
      ) : !task ? (
        <div className="detail-empty">
          <span className="target-mark" aria-hidden="true"><Icon name="inbox" size={25} /></span>
          <strong>选择一个任务</strong>
          <p>查看运行轨迹、错误原因和可执行的安全操作。</p>
        </div>
      ) : (
        <m.div
          className="detail-content"
          key={`${task.kind}:${task.id}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .2, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="kicker">{kindLabel(task.kind)} / {task.source.toUpperCase()}</p>
          <h2 className="detail-title" id="detail-title">{task.title}</h2>
          <div className="detail-state">
            <Status status={task.status} />
            <span>{task.description || "无补充说明"}</span>
          </div>
          <dl className="detail-grid">
            {[
              ["更新时间", formatTime(task.updatedAt)],
              ["会话", task.sessionId ?? "—"],
              ["工具调用", String(task.progress?.toolCalls ?? "—")],
              ["轮次", String(task.progress?.turns ?? "—")],
              ["Token", String(task.progress?.tokens ?? "—")],
              ["下次运行", formatTime(task.nextRunAt)],
              ...(task.lifecyclePhase ? [["阶段", task.lifecyclePhase]] : []),
              ...(task.strategyTier ? [["推理策略", task.strategyTier]] : []),
              ...(task.completionStatus ? [["完成判定", task.completionStatus]] : []),
              ...(task.planProgress
                ? [[
                    "计划进度",
                    `${task.planProgress.completedSteps}/${task.planProgress.totalSteps}` +
                      ((task.planProgress.failedSteps ?? 0) > 0
                        ? ` (失败 ${task.planProgress.failedSteps})`
                        : ""),
                  ]]
                : []),
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd title={value}>{value}</dd>
              </div>
            ))}
          </dl>

          {task.error && (
            <p className="error-copy" role="alert">
              {task.error.code ? `[${task.error.code}] ` : ""}{task.error.message}
            </p>
          )}

          {!!task.actions.length && (
            <div className="detail-actions" aria-label="任务操作">
              {task.actions.map((action) => {
                const spec = taskActionSpec(action);
                const pending = actionPending === actionPendingKey(task, action);
                return (
                  <button
                    key={action}
                    ref={(node) => { actionTriggers.current[action] = node; }}
                    type="button"
                    className={taskActionButtonClass(action)}
                    disabled={actionPending !== null || confirmAction !== null}
                    aria-busy={pending}
                    data-action={action}
                    onClick={() => requestAction(action)}
                  >
                    {pending && <span className="button-spinner" aria-hidden="true" />}
                    {pending ? spec.busyLabel : spec.label}
                  </button>
                );
              })}
            </div>
          )}

          {confirmation && (
            <div
              className="danger-confirm"
              role="group"
              aria-live="assertive"
              aria-label={confirmation.groupLabel}
            >
              <div className="danger-confirm-copy">
                <span className="danger-confirm-icon"><Icon name="warning" size={18} /></span>
                <p>
                  <strong>{confirmation.title}</strong>
                  <span>{confirmation.description}</span>
                </p>
              </div>
              <div className="danger-confirm-actions">
                <button ref={confirmBackRef} className="button button-ghost" type="button" onClick={dismissConfirm}>
                  {confirmation.cancelLabel}
                </button>
                <button
                  className="button button-danger"
                  type="button"
                  disabled={actionPending !== null}
                  onClick={() => confirmAction && executeAction(confirmAction)}
                >
                  {confirmation.confirmLabel}
                </button>
              </div>
            </div>
          )}

          <section className="detail-log" aria-labelledby="log-heading">
            <div className="log-heading">
              <p className="kicker" id="log-heading">RECENT LOG</p>
              <span>{Math.min(detail?.events.length ?? 0, 30)} 条</span>
            </div>
            {detail?.events.length ? (
              <ol className="event-log">
                {detail.events.slice(-30).reverse().map((event, index) => {
                  const data = event.data && typeof event.data === "object"
                    ? event.data as Record<string, unknown>
                    : {};
                  return (
                    <li key={index}>
                      <time dateTime={dateTime(Number(event.timestamp))}>{formatTime(Number(event.timestamp))}</time>
                      <span>{String(data.message ?? data.reason ?? data.action ?? event.type ?? "本地事件")}</span>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="log-empty">暂无运行事件，任务产生新轨迹后会显示在这里。</p>}
          </section>
        </m.div>
      )}
    </aside>
  );
}