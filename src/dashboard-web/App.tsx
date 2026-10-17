import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DashboardSnapshot,
  DashboardTask,
  DashboardTaskAction,
  DashboardTaskDetail,
  DashboardTaskKind,
} from "../dashboard/types";

const ACTIVE = new Set(["running", "blocked", "queued", "paused"]);
const STATUS_LABEL: Record<string, string> = {
  running: "运行中", queued: "等待", blocked: "阻塞", paused: "暂停",
  exhausted: "未完成", succeeded: "完成", failed: "失败", canceled: "取消",
};
const STATUS_ICON: Record<string, string> = {
  running: "◉", queued: "◌", blocked: "◆", paused: "Ⅱ",
  exhausted: "◇", succeeded: "✓", failed: "×", canceled: "—",
};
const KIND_LABEL: Record<string, string> = { mission: "MISSION", loop: "LOOP", workflow: "WORKFLOW" };

function formatTime(value?: number): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function relativeTime(value?: number): string {
  if (!value) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s 前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m 前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h 前`;
  return `${Math.floor(seconds / 86400)}d 前`;
}

function DotGrid() {
  return <div className="dot-grid" aria-hidden="true" />;
}

function Status({ status }: { status: string }) {
  return <span className={`status status-${status}`}><b aria-hidden="true">{STATUS_ICON[status] ?? "·"}</b>{STATUS_LABEL[status] ?? status}</span>;
}

function TaskRow({ task, selected, onSelect }: { task: DashboardTask; selected: boolean; onSelect: () => void }) {
  return (
    <motion.button
      layout
      type="button"
      className={`task-row${selected ? " selected" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
      whileTap={{ scale: 0.995 }}
    >
      <span className="task-signal" data-status={task.status} aria-hidden="true" />
      <span className="task-copy">
        <span className="task-meta"><span>{KIND_LABEL[task.kind]}</span><Status status={task.status} /><span>{task.source.toUpperCase()}</span></span>
        <strong className="task-title">{task.title}</strong>
        <span className="task-description">{task.description || "无补充说明"}</span>
      </span>
      <time className="task-time">{relativeTime(task.updatedAt)}</time>
    </motion.button>
  );
}

function DetailPane({
  detail, loading, onClose, onAction,
}: {
  detail: DashboardTaskDetail | null;
  loading: boolean;
  onClose: () => void;
  onAction: (task: DashboardTask, action: DashboardTaskAction) => Promise<void>;
}) {
  const task = detail?.task;
  return (
    <aside id="detail-pane" className={`detail-pane${task || loading ? " open" : ""}`} aria-label="任务详情">
      {!task ? (
        <div className="detail-empty">
          <span className="target-mark" aria-hidden="true">⌖</span>
          <strong>{loading ? "读取本地任务…" : "选择一个任务"}</strong>
          <p>查看运行轨迹、错误原因和可执行的安全操作。</p>
        </div>
      ) : (
        <motion.div className="detail-content" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .22, ease: [0.22, 1, 0.36, 1] }}>
          <button className="button button-ghost detail-close" type="button" onClick={onClose}>关闭</button>
          <p className="kicker">{KIND_LABEL[task.kind]} / {task.source.toUpperCase()}</p>
          <h2 className="detail-title">{task.title}</h2>
          <div className="detail-state"><Status status={task.status} /><span>{task.description || "无补充说明"}</span></div>
          <dl className="detail-grid">
            {[
              ["更新时间", formatTime(task.updatedAt)], ["会话", task.sessionId ?? "—"],
              ["工具调用", String(task.progress?.toolCalls ?? "—")], ["轮次", String(task.progress?.turns ?? "—")],
              ["Token", String(task.progress?.tokens ?? "—")], ["下次运行", formatTime(task.nextRunAt)],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          {task.error && <p className="error-copy" role="alert">{task.error.code ? `[${task.error.code}] ` : ""}{task.error.message}</p>}
          {!!task.actions.length && <div className="detail-actions">{task.actions.map((action) =>
            <button key={action} className={`button ${action === "resume" || action === "retry" ? "button-primary" : action === "cancel" ? "button-danger" : ""}`} onClick={() => void onAction(task, action)}>
              {({ pause: "暂停", resume: "恢复", cancel: "取消", retry: "重新执行" } as Record<string, string>)[action]}
            </button>
          )}</div>}
          {!!detail.events.length && <>
            <p className="kicker log-heading">RECENT LOG</p>
            <ol className="event-log">{detail.events.slice(-30).reverse().map((event, index) => {
              const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
              return <li key={index}><time>{formatTime(Number(event.timestamp))}</time><span>{String(data.message ?? data.reason ?? data.action ?? event.type ?? "本地事件")}</span></li>;
            })}</ol>
          </>}
        </motion.div>
      )}
    </aside>
  );
}

export function App() {
  const reducedMotion = useReducedMotion();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [detail, setDetail] = useState<DashboardTaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selected, setSelected] = useState<{ id: string; kind: DashboardTaskKind } | null>(null);
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const etag = useRef("");

  const refresh = useCallback(async (force = false) => {
    const headers: HeadersInit = {};
    if (etag.current && !force) headers["If-None-Match"] = etag.current;
    const response = await fetch("/api/dashboard/snapshot", { headers });
    if (response.status === 304) return;
    if (!response.ok) throw new Error(`快照请求失败 (${response.status})`);
    etag.current = response.headers.get("etag") ?? "";
    setSnapshot(await response.json() as DashboardSnapshot);
  }, []);

  useEffect(() => {
    let timer = 0;
    const poll = async () => {
      if (!document.hidden) await refresh().catch((error) => setNotice(error instanceof Error ? error.message : String(error)));
      timer = window.setTimeout(poll, 3000);
    };
    void poll();
    const onVisibility = () => { if (!document.hidden) void refresh(true); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [refresh]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setSelected(null); setDetail(null); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const tasks = useMemo(() => (snapshot?.tasks ?? []).filter((task) => {
    if (kind !== "all" && task.kind !== kind) return false;
    if (status === "active" && !ACTIVE.has(task.status)) return false;
    if (status === "failed" && task.status !== "failed") return false;
    const query = search.trim().toLowerCase();
    return !query || `${task.title} ${task.description} ${task.id} ${task.sessionId ?? ""}`.toLowerCase().includes(query);
  }), [snapshot, kind, status, search]);

  const selectTask = async (task: DashboardTask) => {
    setSelected({ id: task.id, kind: task.kind });
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.kind)}/${encodeURIComponent(task.id)}`);
      if (!response.ok) throw new Error(`详情请求失败 (${response.status})`);
      setDetail(await response.json() as DashboardTaskDetail);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailLoading(false);
    }
  };

  const runAction = async (task: DashboardTask, action: DashboardTaskAction) => {
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.kind)}/${encodeURIComponent(task.id)}/${action}`, { method: "POST" });
      const body = await response.json() as { message?: string };
      if (!response.ok) throw new Error(body.message ?? `操作失败 (${response.status})`);
      setNotice(body.message ?? "操作已完成");
      await refresh(true);
      await selectTask(task);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const summary = snapshot?.summary;
  return (
    <main className="app-shell">
      {!reducedMotion && <DotGrid />}
      <motion.div className="app-content" initial={reducedMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .42, ease: [0.22, 1, 0.36, 1] }}>
        <header className="command-header">
          <div className="brand"><span className="brand-mark">灵</span><div><p>MISSION CONTROL · LOCAL ONLY</p><h1>轻灵任务工作台</h1></div></div>
          <div className="runtime" aria-live="polite">
            <span className={`runtime-dot${snapshot?.runtime.ready ? " ready" : ""}`} />
            <span>{snapshot?.runtime.ready ? "运行时就绪" : "连接本地运行时"}</span>
            <span className="runtime-meta">{snapshot?.runtime.daemonHealthy ? "DAEMON" : "LOCAL"}</span>
            <span className="runtime-meta">权限 {snapshot?.runtime.permissionMode ?? "—"}</span>
            <button className="button button-ghost" type="button" onClick={() => void refresh(true)}>刷新</button>
          </div>
        </header>

        <section className="trust-line" aria-label="本地安全边界"><span>127.0.0.1</span><span>任务正文不外传</span><span>本地控制面</span><span>{snapshot?.runtime.sessionId?.slice(0, 14) ?? "等待会话"}</span></section>

        <section className="situation" aria-label="任务摘要">
          <div className="situation-lead"><span>当前态势</span><strong>{summary?.total ?? "—"}</strong></div>
          {[["运行", summary?.running], ["等待", (summary?.queued ?? 0) + (summary?.paused ?? 0)], ["阻塞", summary?.blocked], ["失败", summary?.failed]].map(([label, value]) =>
            <div className="metric" key={label}><span>{label}</span><strong>{value ?? "—"}</strong></div>
          )}
          <time><span>最近同步</span><strong>{formatTime(snapshot?.generatedAt)}</strong></time>
        </section>

        <div className="workbench">
          <nav className="session-rail" aria-label="最近会话">
            <div className="rail-heading"><span>SESSIONS</span><b>{snapshot?.sessions.length ?? 0}</b></div>
            {(snapshot?.sessions ?? []).length ? snapshot!.sessions.map((session) =>
              <div className={`session-item${session.active ? " active" : ""}`} key={session.sessionId}>
                <span className="session-name">{session.name}</span>
                <small>{session.turnCount} turns · {session.sessionTokens} tok</small>
                <code title={session.resumeCommand}>{session.resumeCommand}</code>
              </div>
            ) : <p className="rail-empty">暂无最近会话。可在 TUI 开始对话。</p>}
          </nav>

          <section className="task-column" aria-labelledby="task-heading">
            <div className="section-heading"><div><p>LIVE QUEUE</p><h2 id="task-heading">任务队列</h2></div><span>{tasks.length} 项</span></div>
            <label className="search-field"><span aria-hidden="true">⌕</span><input id="task-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索任务、会话或描述" aria-label="搜索任务" /></label>
            <div className="filters" aria-label="任务筛选">
              {([["all", "全部类型"], ["mission", "Mission"], ["loop", "Loop"], ["workflow", "Workflow"]] as const).map(([value, label]) =>
                <button type="button" className={kind === value ? "active" : ""} data-filter-kind={value} aria-pressed={kind === value} onClick={() => setKind(value)} key={value}>{label}</button>
              )}
              <span className="filter-divider" />
              {([["active", "进行中"], ["failed", "仅失败"], ["all", "全部状态"]] as const).map(([value, label]) =>
                <button type="button" className={status === value ? "active" : ""} data-filter-status={value} aria-pressed={status === value} onClick={() => setStatus(value)} key={value}>{label}</button>
              )}
            </div>
            <div id="task-list" className="task-list" aria-live="polite" aria-busy={!snapshot}>
              {!snapshot ? <div className="loading-state">正在读取本地任务…</div> : tasks.length === 0 ? <div className="empty-state"><strong>当前筛选下没有任务</strong><span>可在 TUI 使用 /mission 或 /loop 创建。</span></div> :
                <AnimatePresence initial={false}>{tasks.map((task) => <TaskRow key={`${task.kind}:${task.id}`} task={task} selected={selected?.id === task.id && selected.kind === task.kind} onSelect={() => void selectTask(task)} />)}</AnimatePresence>}
            </div>
          </section>
          <DetailPane detail={detail} loading={detailLoading} onClose={() => { setSelected(null); setDetail(null); }} onAction={runAction} />
        </div>

        <section className="activity-panel">
          <div className="section-heading"><div><p>LOCAL TRACE</p><h2>最近活动</h2></div><span>{snapshot?.boundary.activityTruncated ? "已按边界截断" : `${snapshot?.activity.length ?? 0} 条`}</span></div>
          <ol>{(snapshot?.activity ?? []).slice(0, 8).map((event, index) =>
            <li key={`${event.ts}:${index}`}><time>{formatTime(event.ts)}</time><b>{event.type}</b><span>{Object.entries(event.data).slice(0, 3).map(([key, value]) => `${key}=${String(value).slice(0, 44)}`).join(" · ") || "本地事件"}</span></li>
          )}</ol>
        </section>
        <footer><span>LOCAL-FIRST / NO TELEMETRY</span><span>任务数据留在当前设备</span><span>QLING MISSION CONTROL</span></footer>
      </motion.div>
      {notice && <div className="toast" role="status" onAnimationEnd={() => window.setTimeout(() => setNotice(""), 2600)}>{notice}</div>}
    </main>
  );
}
