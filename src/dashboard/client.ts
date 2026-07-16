import type { DashboardSnapshot, DashboardTask, DashboardTaskDetail } from "./types.js";

const ACTIVE = new Set(["running", "blocked", "queued", "paused"]);
let snapshot: DashboardSnapshot | null = null;
let selectedId = "";
let selectedKind = "";
let kindFilter = "all";
let statusFilter = "all";
let search = "";
let etag = "";
let activeRequest: AbortController | null = null;
let refreshTimer: number | null = null;
let retryDelay = 3000;
let toastTimer: number | null = null;

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`dashboard element missing: ${id}`);
  return node as T;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function formatTime(value?: number): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(value);
}

function relativeTime(value?: number): string {
  if (!value) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s 前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m 前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h 前`;
  return `${Math.floor(seconds / 86400)}d 前`;
}

function statusLabel(status: string): string {
  return ({ running: "运行中", queued: "等待", blocked: "阻塞", paused: "暂停", succeeded: "完成", failed: "失败", canceled: "取消" } as Record<string, string>)[status] ?? status;
}

function kindLabel(kind: string): string {
  return ({ mission: "MISSION", loop: "LOOP", workflow: "WORKFLOW" } as Record<string, string>)[kind] ?? kind;
}

function filteredTasks(): DashboardTask[] {
  if (!snapshot) return [];
  const query = search.toLowerCase();
  return snapshot.tasks.filter((task) => {
    if (kindFilter !== "all" && task.kind !== kindFilter) return false;
    if (statusFilter === "active" && !ACTIVE.has(task.status)) return false;
    if (statusFilter === "failed" && task.status !== "failed") return false;
    return !query || `${task.title} ${task.description} ${task.id} ${task.sessionId ?? ""}`.toLowerCase().includes(query);
  });
}

function renderSummary(): void {
  if (!snapshot) return;
  byId("summary-total").textContent = String(snapshot.summary.total);
  byId("summary-running").textContent = String(snapshot.summary.running);
  byId("summary-queued").textContent = String(snapshot.summary.queued + snapshot.summary.paused);
  byId("summary-blocked").textContent = String(snapshot.summary.blocked);
  byId("summary-failed").textContent = String(snapshot.summary.failed);
  byId("updated-at").textContent = `同步于 ${formatTime(snapshot.generatedAt)}`;
  byId("source-label").textContent = snapshot.runtime.daemonHealthy ? "DAEMON" : "LOCAL";
  byId("runtime-label").textContent = snapshot.runtime.ready ? "运行时就绪" : "等待运行时";
  byId("runtime-signal").classList.toggle("ready", snapshot.runtime.ready);
  byId("permission-label").textContent = `权限 ${snapshot.runtime.permissionMode}`;
  const permTop = document.getElementById("permission-label-top");
  if (permTop) permTop.textContent = `权限 ${snapshot.runtime.permissionMode}`;
  const budget = document.getElementById("budget-label");
  if (budget) {
    const tokens = snapshot.budget?.sessionTokens ?? 0;
    budget.textContent = `Tokens ${tokens}`;
  }
  const live = document.getElementById("agent-live-label");
  if (live && snapshot.agentLive) {
    live.textContent = `会话 ${snapshot.agentLive.sessionId.slice(0, 12)} · turn ${snapshot.agentLive.turnCount}`;
  }
  renderSessions();
}

function renderSessions(): void {
  const rail = document.getElementById("session-list");
  if (!rail || !snapshot) return;
  const sessions = snapshot.sessions ?? [];
  if (sessions.length === 0) {
    rail.replaceChildren(node("span", "muted", "暂无会话。在 TUI 对话后会出现在此。"));
    return;
  }
  rail.replaceChildren(
    ...sessions.map((s) => {
      const chip = node("div", s.active ? "session-chip active" : "session-chip");
      const sid = node("span", "sid", s.name || s.sessionId);
      sid.title = s.sessionId;
      const meta = node(
        "div",
        "meta",
        `${s.turnCount} turns · ${s.sessionTokens} tok${s.active ? " · 当前" : ""}`
      );
      chip.append(sid, meta);
      return chip;
    })
  );
}

function renderTasks(): void {
  const list = byId("task-list");
  list.replaceChildren();
  list.classList.remove("skeleton-stack");
  list.setAttribute("aria-busy", "false");
  const tasks = filteredTasks();
  byId("visible-count").textContent = `${tasks.length} 项`;
  if (tasks.length === 0) {
    list.append(node("div", "empty-copy", "当前筛选下没有任务。可在 TUI 使用 /mission 或 /loop 创建。"));
    return;
  }
  for (const task of tasks) {
    const row = node("button", `task-row${task.id === selectedId ? " selected" : ""}`);
    row.type = "button";
    row.dataset.taskId = task.id;
    row.dataset.taskKind = task.kind;
    row.setAttribute("aria-pressed", String(task.id === selectedId));
    const line = node("span", `status-line ${task.status}`);
    line.setAttribute("aria-hidden", "true");
    const copy = node("span", "task-copy");
    const meta = node("span", "task-meta");
    meta.append(node("span", "", kindLabel(task.kind)), node("span", "", statusLabel(task.status)), node("span", "", task.source.toUpperCase()));
    copy.append(meta, node("span", "task-title", task.title), node("span", "task-description", task.description || "无补充说明"));
    row.append(line, copy, node("time", "task-time", relativeTime(task.updatedAt)));
    row.addEventListener("click", () => void selectTask(task));
    list.append(row);
  }
}

function renderActivity(): void {
  const list = byId<HTMLOListElement>("activity-list");
  list.replaceChildren();
  const activity = snapshot?.activity ?? [];
  if (activity.length === 0) {
    list.append(node("li", "muted", "暂无本地活动指标"));
    return;
  }
  for (const event of activity) {
    const item = node("li");
    item.append(
      node("time", "", formatTime(event.ts)),
      node("span", "activity-type", event.type),
      node("span", "", summarizeData(event.data))
    );
    list.append(item);
  }
  byId("activity-boundary").textContent = snapshot?.boundary.activityTruncated ? "已按 1 MiB 边界截断" : `最近 ${activity.length} 条`;
}

function summarizeData(data: Record<string, unknown>): string {
  return Object.entries(data).slice(0, 4).map(([key, value]) => `${key}=${String(value).slice(0, 60)}`).join(" · ") || "本地事件";
}

async function selectTask(task: DashboardTask): Promise<void> {
  selectedId = task.id;
  selectedKind = task.kind;
  renderTasks();
  const pane = byId("detail-pane");
  pane.classList.add("open");
  const empty = byId("detail-empty");
  const content = byId("detail-content");
  empty.hidden = true;
  content.hidden = false;
  content.replaceChildren(node("p", "muted", "正在读取本地详情…"));
  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(task.kind)}/${encodeURIComponent(task.id)}`);
    if (!response.ok) throw new Error(`详情请求失败 (${response.status})`);
    renderDetail(await response.json() as DashboardTaskDetail);
  } catch (error) {
    content.replaceChildren(node("p", "error-copy", error instanceof Error ? error.message : String(error)));
  }
}

function renderDetail(detail: DashboardTaskDetail): void {
  const task = detail.task;
  const content = byId("detail-content");
  content.replaceChildren();
  const close = node("button", "icon-button detail-close", "关闭");
  close.type = "button";
  close.addEventListener("click", () => byId("detail-pane").classList.remove("open"));
  content.append(close);
  content.append(node("p", "detail-kicker", `${kindLabel(task.kind)} / ${statusLabel(task.status)} / ${task.source.toUpperCase()}`));
  const title = node("h2", "detail-title", task.title);
  content.append(title, node("p", "detail-description", task.description || "无补充说明"));
  const stats = node("div", "detail-grid");
  const values: Array<[string, string]> = [
    ["更新时间", formatTime(task.updatedAt)],
    ["会话", task.sessionId ?? "—"],
    ["工具调用", String(task.progress?.toolCalls ?? "—")],
    ["轮次", String(task.progress?.turns ?? "—")],
    ["Token", String(task.progress?.tokens ?? "—")],
    ["下次运行", formatTime(task.nextRunAt)],
  ];
  for (const [label, value] of values) {
    const stat = node("div", "detail-stat");
    stat.append(node("span", "", label), node("strong", "", value));
    stats.append(stat);
  }
  content.append(stats);
  if (task.error) content.append(node("p", "error-copy", `${task.error.code ? `[${task.error.code}] ` : ""}${task.error.message}`));
  const actions = node("div", "detail-actions");
  for (const action of task.actions) {
    const button = node("button", `action-button ${action === "resume" || action === "retry" ? "primary" : action === "cancel" ? "danger" : ""}`, actionLabel(action));
    button.type = "button";
    button.addEventListener("click", () => void runAction(button, task, action));
    actions.append(button);
  }
  if (task.actions.length) content.append(actions);
  const events = node("ol", "event-log");
  for (const event of detail.events.slice(-30).reverse()) {
    const item = node("li");
    const timeNode = node("time", "", formatTime(Number(event.timestamp)));
    const contentSpan = node("span");
    const badge = node("span", "event-badge");
    const msg = eventMessage(event);
    const type = String(event.type || "");
    if (type.includes("tool_start")) {
      badge.className = "event-badge tool";
      badge.textContent = "TOOL";
    } else if (type.includes("success") || type.includes("complete")) {
      badge.className = "event-badge success";
      badge.textContent = "OK";
    } else if (type.includes("error") || type.includes("fail")) {
      badge.className = "event-badge error";
      badge.textContent = "ERR";
    } else {
      badge.className = "event-badge info";
      badge.textContent = "LOG";
    }
    contentSpan.append(badge, document.createTextNode(msg));
    item.append(timeNode, contentSpan);
    events.append(item);
  }
  if (detail.events.length) content.append(node("p", "detail-kicker", "RECENT LOG"), events);
}

function eventMessage(event: Record<string, unknown>): string {
  const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
  return String(data.message ?? data.reason ?? data.action ?? event.type ?? "事件");
}

function actionLabel(action: string): string {
  return ({ pause: "暂停", resume: "恢复", cancel: "取消", retry: "重新执行" } as Record<string, string>)[action] ?? action;
}

async function runAction(button: HTMLButtonElement, task: DashboardTask, action: string): Promise<void> {
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = "处理中…";
  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(task.kind)}/${encodeURIComponent(task.id)}/${encodeURIComponent(action)}`, { method: "POST" });
    const body = await response.json() as { message?: string };
    if (!response.ok) throw new Error(body.message ?? `操作失败 (${response.status})`);
    showToast(body.message ?? "操作已完成");
    etag = "";
    await refreshSnapshot(true);
    const current = snapshot?.tasks.find((item) => item.id === selectedId && item.kind === selectedKind);
    if (current) await selectTask(current);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), true);
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
}

function showToast(message: string, error = false): void {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.hidden = false;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
}

async function refreshSnapshot(force = false): Promise<void> {
  if (document.hidden && !force) return;
  activeRequest?.abort();
  activeRequest = new AbortController();
  try {
    const headers: HeadersInit = {};
    if (etag && !force) headers["If-None-Match"] = etag;
    const response = await fetch("/api/dashboard/snapshot", { headers, signal: activeRequest.signal });
    if (response.status === 304) {
      retryDelay = 3000;
      scheduleRefresh();
      return;
    }
    if (!response.ok) throw new Error(`快照请求失败 (${response.status})`);
    etag = response.headers.get("etag") ?? "";
    snapshot = await response.json() as DashboardSnapshot;
    renderSummary(); renderTasks(); renderActivity();
    retryDelay = 3000;
    scheduleRefresh();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    byId("runtime-label").textContent = "连接中断";
    showToast(error instanceof Error ? error.message : String(error), true);
    retryDelay = Math.min(30000, retryDelay * 2);
    scheduleRefresh();
  }
}

function scheduleRefresh(): void {
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  if (!document.hidden) refreshTimer = window.setTimeout(() => void refreshSnapshot(), retryDelay);
}

function bindFilters(): void {
  byId<HTMLInputElement>("task-search").addEventListener("input", (event) => {
    search = (event.target as HTMLInputElement).value.trim(); renderTasks();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-filter-kind]").forEach((button) => button.addEventListener("click", () => {
    kindFilter = button.dataset.filterKind ?? "all";
    document.querySelectorAll("[data-filter-kind]").forEach((item) => item.classList.toggle("active", item === button)); renderTasks();
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-filter-status]").forEach((button) => button.addEventListener("click", () => {
    statusFilter = button.dataset.filterStatus ?? "active";
    document.querySelectorAll("[data-filter-status]").forEach((item) => item.classList.toggle("active", item === button)); renderTasks();
  }));
}

byId("refresh-button").addEventListener("click", () => void refreshSnapshot(true));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    activeRequest?.abort();
  } else void refreshSnapshot(true);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") byId("detail-pane").classList.remove("open");
});
bindFilters();
void refreshSnapshot(true);
