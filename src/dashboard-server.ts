// ============================================================
// 轻灵 - Observability Dashboard Server (v0.3)
// 本地 Web 控制台后端，提供只读监控与读写控制接口
// ============================================================

import * as http from "http";
import { MetricsCollector } from "./metrics/collector.js";
import { WorkflowRuntime } from "./workflow-runtime.js";
import { AgentLoop } from "./agent-loop.js";
import { buildLocalPermissionsReport } from "./permissions-report.js";
import { buildLocalStatusReport } from "./local-status-report.js";

export interface DashboardOptions {
  port: number;
  collector: MetricsCollector;
  workflowRuntime: WorkflowRuntime;
  agentLoop: AgentLoop;
}

export class DashboardServer {
  private server!: http.Server;
  private options: DashboardOptions;
  public listening = false;

  constructor(options: DashboardOptions) {
    this.options = options;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url || "/", `http://localhost:${this.options.port}`);

        // 设置 CORS
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        try {
          // --- 路由分发 ---

          // 1. 获取所有指标 (Read-only)
          if (url.pathname === "/api/metrics" && req.method === "GET") {
            const limit = Number(url.searchParams.get("limit")) || 100;
            const metrics = await this.options.collector.query({ limit });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(metrics));
            return;
          }

          // 2. 获取当前状态 (Read-only)
          if (url.pathname === "/api/status" && req.method === "GET") {
            const checkpoint = this.options.workflowRuntime.getCheckpoint();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              checkpoint,
              is_running: (this.options.agentLoop as any).turnCount > 0,
              session_id: (this.options.agentLoop as any).sessionId,
            }));
            return;
          }

          // 2b. 获取所有使命 (Read-only)
          if (url.pathname === "/api/missions" && req.method === "GET") {
            const manager = (this.options.agentLoop as any).getMissionManager();
            const list = manager.listMissions();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(list));
            return;
          }

          // P2 增强: sessions (只读)
          if (url.pathname === "/api/sessions" && req.method === "GET") {
            try {
              const limit = Number(url.searchParams.get("limit")) || 10;
              // 简化：从 workflow 或 agent 获取会话列表
              const sessions = (this.options.agentLoop as any).getRecentSessions?.(limit)
                || [{ id: "current", status: "active" }];
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ sessions }));
            } catch {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ sessions: [] }));
            }
            return;
          }

          // P2 增强: permissions (只读)
          if (url.pathname === "/api/permissions" && req.method === "GET") {
            try {
              const config = (this.options.agentLoop as any).config || {};
              const report = buildLocalPermissionsReport({
                defaultMode: config.guard?.permissions?.default || "ask",
                rules: config.guard?.permissions?.rules || [],
                env: process.env,
              });
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(report));
            } catch {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ defaultMode: "ask", rules: [] }));
            }
            return;
          }

          // P2 增强: doctor 简要快照 (只读)
          if (url.pathname === "/api/doctor" && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              status: "ok",
              node: process.version,
              dashboard: true,
              features: { dashboard: true },
              note: "使用 /doctor 命令获取完整本地诊断"
            }));
            return;
          }

          // 3. 执行控制 (Read-write)
          if (url.pathname === "/api/control/pause" && req.method === "POST") {
            // 物理实现：通过 agentLoop 发射暂停信号 (M3 后续完善信号量)
            this.options.agentLoop.emit("control_signal", "pause");
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, action: "pause", status: "pausing" }));
            return;
          }

          if (url.pathname === "/api/control/resume" && req.method === "POST") {
            this.options.agentLoop.emit("control_signal", "resume");
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, action: "resume", status: "resuming" }));
            return;
          }
          // 4. 静态资源 (前端) - P2: 本地只读可观测控制台 (纯 HTML，无外部依赖)
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>轻灵 Dashboard · 本地可观测</title>
  <style>
    :root { --bg:#0f172a; --card:#1e2937; --text:#e2e8f0; --accent:#22d3ee; --green:#4ade80; --red:#f87171; }
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg); color: var(--text); margin:0; padding:20px; }
    .header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; }
    .card { background:var(--card); border-radius:8px; padding:16px; margin-bottom:16px; border:1px solid #334155; }
    .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px,1fr)); gap:16px; }
    .section-title { font-size:14px; color:#94a3b8; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px; }
    .metric { font-size:13px; line-height:1.6; }
    .metric b { color:var(--accent); }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th, td { padding:6px 8px; text-align:left; border-bottom:1px solid #334155; }
    th { color:#64748b; }
    .pill { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11px; background:#334155; }
    .ok { color:var(--green); } .warn { color:#facc15; } .err { color:var(--red); }
    .log { background:#0b1120; padding:8px; border-radius:4px; font-size:11px; white-space:pre-wrap; max-height:160px; overflow:auto; }
    button { background:var(--accent); color:#0f172a; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:12px; }
    button:disabled { opacity:0.5; cursor:not-allowed; }
    .small { font-size:11px; color:#64748b; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 style="margin:0;font-size:20px;">轻灵 · 本地 Dashboard</h1>
      <div class="small">端口 <span id="port"></span> · 只读观测 · <span id="status">加载中...</span></div>
    </div>
    <div>
      <button onclick="refreshAll()">刷新</button>
      <button onclick="pauseMission()" style="margin-left:8px;">暂停</button>
      <button onclick="resumeMission()" style="margin-left:4px;">恢复</button>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="section-title">当前状态</div>
      <div id="status-panel" class="metric">加载中...</div>
    </div>

    <div class="card">
      <div class="section-title">权限与边界</div>
      <div id="perm-panel" class="metric">加载中...</div>
    </div>

    <div class="card">
      <div class="section-title">Missions / 任务</div>
      <div id="missions-panel">加载中...</div>
    </div>

    <div class="card">
      <div class="section-title">会话 Sessions</div>
      <div id="sessions-panel">加载中...</div>
    </div>

    <div class="card">
      <div class="section-title">Doctor 快照</div>
      <div id="doctor-panel">加载中...</div>
    </div>

    <div class="card">
      <div class="section-title">最近指标 / 工具调用 (最近 20)</div>
      <div id="metrics-panel" class="log">加载中...</div>
    </div>
  </div>

  <div class="card">
    <div class="section-title">API 端点（只读优先）</div>
    <div class="small">
      GET /api/status &nbsp;|&nbsp; GET /api/missions &nbsp;|&nbsp; GET /api/metrics?limit=50<br>
      POST /api/control/pause &nbsp;|&nbsp; POST /api/control/resume
    </div>
  </div>

  <script>
    const port = window.location.port || '9999';
    document.getElementById('port').textContent = port;

    async function fetchJSON(path) {
      const res = await fetch('/' + path);
      if (!res.ok) throw new Error(res.status);
      return res.json();
    }

    async function loadStatus() {
      try {
        const s = await fetchJSON('api/status');
        const el = document.getElementById('status-panel');
        el.innerHTML = \`
          <b>运行中</b>: \${s.is_running ? '是' : '否'}<br>
          <b>会话</b>: \${s.session_id || '-'}<br>
          <b>Checkpoint</b>: \${s.checkpoint ? '有' : '无'}
        \`;
        document.getElementById('status').textContent = '就绪';
        document.getElementById('status').className = 'ok';
      } catch(e) {
        document.getElementById('status-panel').textContent = '无法获取状态';
      }
    }

    async function loadMissions() {
      try {
        const list = await fetchJSON('api/missions');
        const el = document.getElementById('missions-panel');
        if (!list || list.length === 0) { el.innerHTML = '<div class="small">暂无活跃使命</div>'; return; }
        el.innerHTML = list.slice(0,5).map(m => \`
          <div class="metric">
            <b>\${m.id?.slice(0,12) || 'mission'}</b> · \${m.status || ''}<br>
            <span class="small">\${(m.goal || '').slice(0,60)}</span>
          </div>
        \`).join('');
      } catch(e) { document.getElementById('missions-panel').innerHTML = '获取失败'; }
    }

    async function loadMetrics() {
      try {
        const data = await fetchJSON('api/metrics?limit=20');
        const el = document.getElementById('metrics-panel');
        if (!data || !data.length) { el.textContent = '暂无指标'; return; }
        el.textContent = data.slice(0,12).map(m => {
          const t = new Date(m.ts || Date.now()).toLocaleTimeString();
          return \`\${t} | \${m.type || 'event'} \${JSON.stringify(m.payload || {}).slice(0,80)}\`;
        }).join('\\n');
      } catch(e) { document.getElementById('metrics-panel').textContent = '获取失败'; }
    }

    async function loadPerm() {
      try {
        const p = await fetchJSON('api/permissions');
        const el = document.getElementById('perm-panel');
        el.innerHTML = \`
          <b>默认</b>: \${p.defaultMode || 'ask'}<br>
          <b>规则</b>: \${p.rules?.length || 0}<br>
          <span class="small">本地权限边界</span>
        \`;
      } catch(e) {
        const el = document.getElementById('perm-panel');
        el.innerHTML = '权限信息获取失败';
      }
    }

    async function loadSessions() {
      try {
        const s = await fetchJSON('api/sessions');
        let el = document.getElementById('sessions-panel');
        if (!el) return;
        const list = s.sessions || [];
        el.innerHTML = list.length ? list.slice(0,3).map((sess: any) => \`<div class="metric"><b>\${(sess.id||'sess').slice(0,12)}</b> \${sess.status||''}</div>\`).join('') : '<div class="small">无活跃会话</div>';
      } catch(e){}
    }

    async function loadDoctor() {
      try {
        const d = await fetchJSON('api/doctor');
        let el = document.getElementById('doctor-panel');
        if (!el) return;
        el.innerHTML = \`<b>状态</b>: \${d.status || 'ok'} <span class="pill ok">本地</span>\`;
      } catch(e){}
    }

    async function refreshAll() {
      await Promise.all([loadStatus(), loadMissions(), loadMetrics(), loadPerm(), loadSessions(), loadDoctor()]);
    }

    async function pauseMission() {
      try { await fetch('/api/control/pause', {method:'POST'}); alert('暂停信号已发送'); refreshAll(); } catch(e){}
    }
    async function resumeMission() {
      try { await fetch('/api/control/resume', {method:'POST'}); alert('恢复信号已发送'); refreshAll(); } catch(e){}
    }

    // 启动
    refreshAll();
    setInterval(refreshAll, 15000); // 15s 自动刷新
  </script>
</body>
</html>`);

        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });

      this.server.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          reject(new Error(`EADDRINUSE: 端口 ${this.options.port} 已被占用`));
        } else {
          reject(err);
        }
      });

      this.server.listen(this.options.port, () => {
        console.error(`🚀 Dashboard 运行在: http://localhost:${this.options.port}`);
        this.listening = true;
        resolve();
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.listening = false;
  }
}
