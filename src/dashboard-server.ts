// ============================================================
// 轻灵 - Observability Dashboard Server (v0.3)
// 本地 Web 控制台后端，提供只读监控与读写控制接口
// ============================================================

import * as http from "http";
import { MetricsCollector } from "./metrics/collector.js";
import { WorkflowRuntime } from "./workflow-runtime.js";
import { AgentLoop } from "./agent-loop.js";

export interface DashboardOptions {
  port: number;
  collector: MetricsCollector;
  workflowRuntime: WorkflowRuntime;
  agentLoop: AgentLoop;
}

export class DashboardServer {
  private server!: http.Server;
  private options: DashboardOptions;

  constructor(options: DashboardOptions) {
    this.options = options;
  }

  start(): void {
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
            is_running: (this.options.agentLoop as any).turnCount > 0, // 简化判断
            session_id: (this.options.agentLoop as any).sessionId,
          }));
          return;
        }

        // 3. 执行控制 (Read-write)
        if (url.pathname === "/api/control/pause" && req.method === "POST") {
          // TODO: 实现暂停逻辑
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, action: "pause" }));
          return;
        }

        if (url.pathname === "/api/control/resume" && req.method === "POST") {
          // TODO: 实现恢复逻辑
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, action: "resume" }));
          return;
        }

        // 4. 静态资源 (前端) - 暂返回简单文本，后续接入前端产物
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>轻灵 Observability Dashboard</h1><p>API 端点已就绪 (v0.3)</p>");

      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });

    this.server.listen(this.options.port, () => {
      console.error(`🚀 Dashboard 运行在: http://localhost:${this.options.port}`);
    });
  }

  stop(): void {
    this.server?.close();
  }
}
