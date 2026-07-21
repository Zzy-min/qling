import * as http from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { AgentLoop } from "./agent-loop.js";
import { buildDashboardTasks } from "./dashboard/model.js";
import { DASHBOARD_CSS, DASHBOARD_HTML } from "./dashboard/page.js";
import type {
  DashboardControlResult,
  DashboardSnapshot,
  DashboardTask,
  DashboardTaskDetail,
  DashboardTaskKind,
} from "./dashboard/types.js";
import type { MetricsCollector } from "./metrics/collector.js";
import type { Mission } from "./mission/types.js";
import { buildLocalPermissionsReport } from "./permissions-report.js";
import {
  cancelLocalSessionTask,
  listLocalSessionTasks,
} from "./session-task-report.js";
import type { WorkflowRuntime } from "./workflow-runtime.js";

export interface DashboardOptions {
  port: number;
  collector: MetricsCollector;
  workflowRuntime: WorkflowRuntime;
  agentLoop: AgentLoop;
}

interface SnapshotCache {
  snapshot: DashboardSnapshot;
  payload: string;
  etag: string;
  expiresAt: number;
}

const SNAPSHOT_CACHE_MS = 750;
const DAEMON_PROBE_MS = 5_000;
const TASK_LIMIT = 50;
const TASK_SCAN_LIMIT = 5_000;
const ACTIVITY_LIMIT = 20;
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const CLIENT_URL = new URL("./dashboard/client.js", import.meta.url);

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(value));
}

function summaryFor(tasks: DashboardTask[]): DashboardSnapshot["summary"] {
  const summary: DashboardSnapshot["summary"] = {
    total: tasks.length,
    queued: 0,
    running: 0,
    blocked: 0,
    paused: 0,
    exhausted: 0,
    succeeded: 0,
    failed: 0,
    canceled: 0,
  };
  for (const task of tasks) summary[task.status]++;
  return summary;
}

function parseTaskRoute(pathname: string): {
  kind: DashboardTaskKind;
  id: string;
  action?: string;
} | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "tasks" || parts.length < 4 || parts.length > 5) {
    return null;
  }
  const kind = parts[2] as DashboardTaskKind;
  if (!(["mission", "loop", "workflow"] as string[]).includes(kind)) return null;
  try {
    return {
      kind,
      id: decodeURIComponent(parts[3]),
      action: parts[4] ? decodeURIComponent(parts[4]) : undefined,
    };
  } catch {
    return null;
  }
}

export class DashboardServer {
  private server!: http.Server;
  private readonly options: DashboardOptions;
  private snapshotCache: SnapshotCache | null = null;
  private daemonHealthy = false;
  private daemonTimer: ReturnType<typeof setInterval> | null = null;
  private clientSource: string | null = null;
  public listening = false;

  constructor(options: DashboardOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.listening) return;
    this.server = http.createServer((req, res) => void this.handleRequest(req, res));
    const preferred = Number(this.options.port) || 9999;
    const maxAttempts = 12;
    let lastErr: Error | null = null;
    for (let i = 0; i < maxAttempts; i++) {
      const port = preferred + i;
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (err: NodeJS.ErrnoException) => {
            reject(err);
          };
          this.server.once("error", onError);
          this.server.listen(port, "127.0.0.1", () => {
            this.server.off("error", onError);
            this.options.port = port;
            this.listening = true;
            if (i > 0) {
              console.error(
                `🚀 Dashboard 运行在: http://127.0.0.1:${port}（${preferred} 占用，已自动换端口）`
              );
            } else {
              console.error(`🚀 Dashboard 运行在: http://127.0.0.1:${port}`);
            }
            resolve();
          });
        });
        lastErr = null;
        break;
      } catch (err: any) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (err?.code !== "EADDRINUSE") throw lastErr;
        // 端口占用：关掉半开 server 再试下一个
        try {
          this.server.close();
        } catch {
          // ignore
        }
        this.server = http.createServer((req, res) => void this.handleRequest(req, res));
      }
    }
    if (!this.listening) {
      throw lastErr ?? new Error(`EADDRINUSE: 端口 ${preferred}–${preferred + maxAttempts - 1} 均被占用`);
    }
    void this.probeDaemon();
    this.daemonTimer = setInterval(() => void this.probeDaemon(), DAEMON_PROBE_MS);
    this.daemonTimer.unref?.();
  }

  stop(): void {
    if (this.daemonTimer) clearInterval(this.daemonTimer);
    this.daemonTimer = null;
    this.server?.close();
    this.listening = false;
  }

  private setSecurityHeaders(res: http.ServerResponse): void {
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
  }

  private sameOriginAllowed(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true;
    return origin === `http://127.0.0.1:${this.options.port}` || origin === `http://localhost:${this.options.port}`;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.setSecurityHeaders(res);
    if (!this.sameOriginAllowed(req)) {
      sendJson(res, 403, { error: "cross-origin dashboard request denied" });
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://127.0.0.1:${this.options.port}`);
    try {
      if (url.pathname === "/" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        res.end(DASHBOARD_HTML);
        return;
      }
      if (url.pathname === "/assets/dashboard.css" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        });
        res.end(DASHBOARD_CSS);
        return;
      }
      if (url.pathname === "/assets/dashboard.js" && req.method === "GET") {
        this.clientSource ??= await readFile(CLIENT_URL, "utf-8");
        res.writeHead(200, {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        res.end(this.clientSource);
        return;
      }
      if (url.pathname === "/api/dashboard/snapshot" && req.method === "GET") {
        await this.serveSnapshot(req, res);
        return;
      }

      const taskRoute = parseTaskRoute(url.pathname);
      if (taskRoute && req.method === "GET" && !taskRoute.action) {
        sendJson(res, 200, await this.buildTaskDetail(taskRoute.kind, taskRoute.id));
        return;
      }
      if (taskRoute && req.method === "POST" && taskRoute.action) {
        const result = await this.controlTask(taskRoute.kind, taskRoute.id, taskRoute.action);
        sendJson(res, result.status, result.body);
        return;
      }

      if (url.pathname === "/api/metrics" && req.method === "GET") {
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 100));
        const recent = await this.options.collector.queryRecent({ limit });
        sendJson(res, 200, recent.events);
        return;
      }
      if (url.pathname === "/api/status" && req.method === "GET") {
        sendJson(res, 200, {
          checkpoint: this.options.workflowRuntime.getCheckpoint(),
          is_running: (this.options.agentLoop as any).turnCount > 0,
          session_id: this.getSessionId(),
        });
        return;
      }
      if (url.pathname === "/api/missions" && req.method === "GET") {
        const manager = this.options.agentLoop.getMissionManager();
        await manager.refresh();
        sendJson(res, 200, manager.listMissions());
        return;
      }
      if (url.pathname === "/api/sessions" && req.method === "GET") {
        sendJson(res, 200, { sessions: [{ id: this.getSessionId(), status: "active" }] });
        return;
      }
      if (url.pathname === "/api/permissions" && req.method === "GET") {
        sendJson(res, 200, this.permissionsReport());
        return;
      }
      if (url.pathname === "/api/doctor" && req.method === "GET") {
        sendJson(res, 200, {
          status: "ok",
          node: process.version,
          dashboard: true,
          daemonHealthy: this.daemonHealthy,
          note: "使用 /doctor 命令获取完整本地诊断",
        });
        return;
      }
      if (url.pathname === "/api/control/pause" && req.method === "POST") {
        this.options.agentLoop.emit("control_signal", "pause");
        sendJson(res, 200, { ok: true, action: "pause", status: "pausing" });
        return;
      }
      if (url.pathname === "/api/control/resume" && req.method === "POST") {
        this.options.agentLoop.emit("control_signal", "resume");
        sendJson(res, 200, { ok: true, action: "resume", status: "resuming" });
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        sendJson(res, 404, { error: `dashboard route not found: ${url.pathname}` });
        return;
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      const status = Number((err as { statusCode?: number }).statusCode) || 500;
      sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async serveSnapshot(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const cache = await this.getSnapshot();
    if (req.headers["if-none-match"] === cache.etag) {
      res.writeHead(304, { ETag: cache.etag, "Cache-Control": "no-cache" });
      res.end();
      return;
    }
    res.writeHead(200, {
      ...JSON_HEADERS,
      ETag: cache.etag,
      "Cache-Control": "no-cache",
    });
    res.end(cache.payload);
  }

  private async getSnapshot(): Promise<SnapshotCache> {
    const now = Date.now();
    if (this.snapshotCache && this.snapshotCache.expiresAt > now) return this.snapshotCache;

    const manager = this.options.agentLoop.getMissionManager();
    await manager.refresh();
    const loopsReport = await listLocalSessionTasks(this.getStateDir(), {
      count: TASK_SCAN_LIMIT,
      maxCount: TASK_SCAN_LIMIT,
    });
    const recent = await this.options.collector.queryRecent({
      limit: ACTIVITY_LIMIT,
      maxScanBytes: 1024 * 1024,
    });
    const allTasks = buildDashboardTasks({
      missions: manager.listMissions(),
      loops: loopsReport.tasks,
      workflow: this.options.workflowRuntime.getCheckpoint(),
      daemonHealthy: this.daemonHealthy,
      now,
    });
    const tasks = allTasks.slice(0, TASK_LIMIT);

    let sessions: DashboardSnapshot["sessions"] = [];
    try {
      const listed = await this.options.agentLoop.listSessionsDetailed();
      const currentId = this.getSessionId();
      sessions = listed.slice(0, 12).map((s) => ({
        sessionId: s.sessionId,
        name: s.title || s.name || s.sessionId,
        updatedAt: s.updatedAt,
        turnCount: s.turnCount,
        messageCount: s.messageCount,
        sessionTokens: s.sessionTokens,
        active: s.sessionId === currentId,
        // G4.3 双向深链：Web → TUI
        resumeCommand: `qling --resume ${s.sessionId}`,
      }));
    } catch {
      sessions = [
        {
          sessionId: this.getSessionId(),
          name: this.getSessionId(),
          updatedAt: new Date(now).toISOString(),
          turnCount: Number((this.options.agentLoop as unknown as { turnCount?: number }).turnCount ?? 0),
          messageCount: 0,
          sessionTokens: 0,
          active: true,
          resumeCommand: `qling --resume ${this.getSessionId()}`,
        },
      ];
    }

    const currentTokens =
      sessions.find((s) => s.active)?.sessionTokens ??
      sessions[0]?.sessionTokens ??
      0;

    const stable = {
      runtime: {
        ready: true,
        sessionId: this.getSessionId(),
        daemonHealthy: this.daemonHealthy,
        daemonSource: this.daemonHealthy ? "daemon" as const : "local" as const,
        permissionMode: this.getPermissionMode(),
      },
      summary: summaryFor(allTasks),
      tasks,
      sessions,
      agentLive: {
        sessionId: this.getSessionId(),
        turnCount: Number((this.options.agentLoop as unknown as { turnCount?: number }).turnCount ?? 0),
        ready: true,
      },
      budget: {
        sessionTokens: currentTokens,
        contextLimit: null as number | null,
      },
      activity: recent.events,
      boundary: {
        localOnly: true as const,
        activityTruncated: recent.truncated,
        activityScannedBytes: recent.scannedBytes,
      },
    };
    const revision = createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
    const snapshot: DashboardSnapshot = { generatedAt: now, revision, ...stable };
    const payload = JSON.stringify(snapshot);
    this.snapshotCache = {
      snapshot,
      payload,
      etag: `"${revision}"`,
      expiresAt: now + SNAPSHOT_CACHE_MS,
    };
    return this.snapshotCache;
  }

  private async buildTaskDetail(kind: DashboardTaskKind, id: string): Promise<DashboardTaskDetail> {
    if (kind === "mission") {
      const manager = this.options.agentLoop.getMissionManager();
      await manager.refresh();
      const mission = manager.getMissionOrThrow(id);
      const task = buildDashboardTasks({ missions: [mission], loops: [], workflow: null, daemonHealthy: this.daemonHealthy })[0];
      return { task, detail: mission as unknown as Record<string, unknown>, events: await manager.getMissionLogs(id) as unknown as Array<Record<string, unknown>> };
    }
    if (kind === "loop") {
      const report = await listLocalSessionTasks(this.getStateDir(), {
        count: TASK_SCAN_LIMIT,
        maxCount: TASK_SCAN_LIMIT,
      });
      const loop = report.tasks.find((task) => task.id === id);
      if (!loop) throw Object.assign(new Error(`session task not found: ${id}`), { statusCode: 404 });
      const task = buildDashboardTasks({ missions: [], loops: [loop], workflow: null, daemonHealthy: this.daemonHealthy })[0];
      const trace = task.sessionId ? await this.options.agentLoop.getRecentRunTrace(task.sessionId) : [];
      return { task, detail: loop as unknown as Record<string, unknown>, events: trace as unknown as Array<Record<string, unknown>> };
    }
    const workflow = this.options.workflowRuntime.getCheckpoint();
    if (!workflow || workflow.runId !== id) {
      throw Object.assign(new Error(`workflow not found: ${id}`), { statusCode: 404 });
    }
    const task = buildDashboardTasks({ missions: [], loops: [], workflow, daemonHealthy: this.daemonHealthy })[0];
    const trace = await this.options.agentLoop.getRecentRunTrace(this.getSessionId());
    return {
      task,
      detail: workflow as unknown as Record<string, unknown>,
      events: [...workflow.history, ...trace] as unknown as Array<Record<string, unknown>>,
    };
  }

  private async controlTask(kind: DashboardTaskKind, id: string, action: string): Promise<{ status: number; body: DashboardControlResult }> {
    if (kind === "workflow") {
      return { status: 405, body: { ok: false, source: "local", message: "Workflow 在 Dashboard 中仅供查看" } };
    }
    if (kind === "loop") {
      if (action !== "cancel") return { status: 405, body: { ok: false, source: "local", message: "Loop task 仅支持 cancel" } };
      const loop = await cancelLocalSessionTask(this.getStateDir(), id);
      this.invalidateSnapshot();
      const task = buildDashboardTasks({ missions: [], loops: [loop], workflow: null, daemonHealthy: this.daemonHealthy })[0];
      return { status: 200, body: { ok: true, source: "local", task, message: `已取消循环任务 ${id}` } };
    }

    if (!(["pause", "resume", "cancel", "retry"] as string[]).includes(action)) {
      return { status: 405, body: { ok: false, source: "local", message: `Mission 不支持操作 ${action}` } };
    }
    if (action === "retry" && !this.daemonHealthy) {
      return { status: 503, body: { ok: false, source: "local", message: "重试需要运行中的 qling daemon；请先执行 qling daemon start" } };
    }

    if (this.daemonHealthy) {
      const remote = await this.controlMissionViaDaemon(id, action);
      if (remote) return remote;
      if (action === "retry") {
        return { status: 503, body: { ok: false, source: "local", message: "Daemon 已离线，未创建无法执行的重试任务" } };
      }
    }

    const manager = this.options.agentLoop.getMissionManager();
    await manager.refresh();
    let mission: Mission;
    if (action === "pause") mission = await manager.pauseMission(id, "dashboard_local");
    else if (action === "resume") mission = await manager.resumeMission(id, "dashboard_local");
    else mission = await manager.cancelMission(id, "dashboard_local");
    this.invalidateSnapshot();
    const task = buildDashboardTasks({ missions: [mission], loops: [], workflow: null, daemonHealthy: false })[0];
    return { status: 200, body: { ok: true, source: "local", task, message: `已在本地状态中${this.actionLabel(action)} ${mission.name}` } };
  }

  private async controlMissionViaDaemon(id: string, action: string): Promise<{ status: number; body: DashboardControlResult } | null> {
    try {
      const response = await fetch(`${this.daemonUrl()}/missions/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        signal: AbortSignal.timeout(1_200),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        return { status: response.status, body: { ok: false, source: "daemon", message: body.error ?? `Daemon 操作失败 (${response.status})` } };
      }
      const body = await response.json() as { mission?: Mission; missionId?: string };
      const manager = this.options.agentLoop.getMissionManager();
      await manager.refresh();
      const mission = body.mission ?? manager.getMission(body.missionId ?? id);
      const task = mission ? buildDashboardTasks({ missions: [mission], loops: [], workflow: null, daemonHealthy: true })[0] : undefined;
      this.invalidateSnapshot();
      return { status: 200, body: { ok: true, source: "daemon", task, message: `Daemon 已${this.actionLabel(action)}任务` } };
    } catch {
      this.daemonHealthy = false;
      this.invalidateSnapshot();
      return null;
    }
  }

  private async probeDaemon(): Promise<void> {
    try {
      const response = await fetch(`${this.daemonUrl()}/health`, { signal: AbortSignal.timeout(350) });
      const healthy = response.ok;
      if (healthy !== this.daemonHealthy) {
        this.daemonHealthy = healthy;
        this.invalidateSnapshot();
      }
    } catch {
      if (this.daemonHealthy) {
        this.daemonHealthy = false;
        this.invalidateSnapshot();
      }
    }
  }

  private permissionsReport(): ReturnType<typeof buildLocalPermissionsReport> {
    const config = (this.options.agentLoop as any).config || {};
    return buildLocalPermissionsReport({
      defaultMode: config.guard?.permissions?.default || this.getPermissionMode(),
      rules: config.guard?.permissions?.rules || [],
      env: process.env,
    });
  }

  private getStateDir(): string {
    return this.options.agentLoop.getRuntimeRootDir();
  }

  private getSessionId(): string {
    return this.options.agentLoop.getSessionId();
  }

  private getPermissionMode(): string {
    return this.options.agentLoop.getPermissionMode?.() ?? "ask";
  }

  private daemonUrl(): string {
    const port = Number(process.env.QLING_DAEMON_PORT) || 9998;
    return `http://127.0.0.1:${port}`;
  }

  private actionLabel(action: string): string {
    return ({ pause: "暂停", resume: "恢复", cancel: "取消", retry: "重试" } as Record<string, string>)[action] ?? action;
  }

  private invalidateSnapshot(): void {
    this.snapshotCache = null;
  }
}
