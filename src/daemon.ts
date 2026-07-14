// ============================================================
// qlingd - 轻灵后台守护进程 (v0.5 M3)
// 负责后台任务执行、队列管理与状态持久化
// ============================================================

import * as http from "http";
import { MissionManager } from "./mission/manager.js";
import { AgentLoop } from "./agent-loop.js";
import { loadQlingConfig, applyConfigToProcessEnv } from "./config.js";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import dotenv from "dotenv";
import { SessionScheduler } from "./session/session-scheduler.js";
import { SessionGoalController } from "./session/goal-controller.js";
import { SessionGoalManager } from "./session/session-goal-manager.js";
import { DurableSessionSupervisor } from "./agent/durable-session-supervisor.js";
import { formatDaemonVersion } from "./package-version.js";

const HOME_DIR = os.homedir();
const DEFAULT_STATE_DIR = path.join(HOME_DIR, ".qling");

function loadEnv() {
  // 1. 项目配置
  let dir = process.cwd();
  while (true) {
    const envPath = path.join(dir, ".env");
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 2. 全局配置
  const globalEnv = path.join(HOME_DIR, ".qling", ".env");
  if (fs.existsSync(globalEnv)) {
    dotenv.config({ path: globalEnv });
  }
}

async function main() {
  loadEnv();

  const stateDir = process.env.QLING_FILE_STATE_DIR || DEFAULT_STATE_DIR;
  const manager = new MissionManager(stateDir);
  await manager.init();
  const startedAt = Date.now();
  const supervisor = new DurableSessionSupervisor({
    stateDir,
    log: (message) => console.log(`[qlingd] ${message}`),
  });

  // 尝试预加载配置并应用到环境变量
  try {
    const { config } = await loadQlingConfig({});
    applyConfigToProcessEnv(config);
  } catch (err) {
    console.error(`[qlingd] Warning: Failed to load config: ${(err as Error).message}`);
  }

  const PORT = Number(process.env.QLING_DAEMON_PORT) || 9998;
  supervisor.start();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);

    res.setHeader("Content-Type", "application/json");

    try {
      // 1. 获取所有使命
      if (url.pathname === "/missions" && req.method === "GET") {
        const list = manager.listMissions();
        res.end(JSON.stringify(list));
        return;
      }

      // 2. 提交新使命
      if (url.pathname === "/missions" && req.method === "POST") {
        const data = await readJsonBody(req);
        const mission = await manager.createMission(data.name, data.description, data.sessionId);
        await manager.appendLog(mission.id, "使命已提交到后台队列", { source: "daemon" });

        // 异步启动任务执行 (Detach) - 传入全量数据以支持状态恢复
        executeMissionInBackground(mission.id, manager, stateDir, data);

        res.end(JSON.stringify({ ok: true, missionId: mission.id }));
        return;
      }

      const missionRoute = matchMissionRoute(url.pathname);
      if (missionRoute) {
        const { id, action } = missionRoute;

        if (!action && req.method === "GET") {
          const mission = manager.getMissionOrThrow(id);
          res.end(JSON.stringify(mission));
          return;
        }

        if (action === "logs" && req.method === "GET") {
          const logs = await manager.getMissionLogs(id);
          res.end(JSON.stringify(logs));
          return;
        }

        if (req.method === "POST") {
          if (action === "pause") {
            const mission = await manager.pauseMission(id, "daemon_api");
            res.end(JSON.stringify({ ok: true, mission }));
            return;
          }
          if (action === "resume") {
            const mission = await manager.resumeMission(id, "daemon_api");
            res.end(JSON.stringify({ ok: true, mission }));
            return;
          }
          if (action === "cancel") {
            const mission = await manager.cancelMission(id, "daemon_api");
            res.end(JSON.stringify({ ok: true, mission }));
            return;
          }
          if (action === "retry") {
            const retried = await manager.retryMission(id);
            await manager.appendLog(retried.id, "使命由 retry 重新排队", {
              source: "daemon",
              sourceMissionId: id,
            });
            executeMissionInBackground(retried.id, manager, stateDir, {
              name: retried.name,
              description: retried.description,
              sessionId: retried.sessionId,
            });
            res.end(JSON.stringify({ ok: true, missionId: retried.id }));
            return;
          }
        }
      }

      const sessionRoute = matchSessionRoute(url.pathname);
      if (sessionRoute) {
        const { sessionId, resource, itemId, action } = sessionRoute;

        if (resource === "loop-tasks") {
          const scheduler = new SessionScheduler({
            stateDir,
            sessionId,
            runner: "daemon",
            onDue: async () => {},
          });
          await scheduler.init();

          if (!itemId && req.method === "GET") {
            res.end(JSON.stringify(await scheduler.listTasks()));
            return;
          }

          if (!itemId && req.method === "POST") {
            const data = await readJsonBody(req);
            const task = await scheduler.createLoopTask({
              prompt: data.prompt,
              intervalMs: Number(data.intervalMs),
              mode: data.mode === "fixed" ? "fixed" : "default",
              runner: "daemon",
            });
            res.end(JSON.stringify(task));
            return;
          }

          if (itemId && action === "cancel" && req.method === "POST") {
            const task = await scheduler.cancelTask(itemId);
            res.end(JSON.stringify(task));
            return;
          }
        }

        if (resource === "goal") {
          const manager = new SessionGoalManager({ stateDir, sessionId });
          const controller = new SessionGoalController({
            manager,
            runner: "daemon",
          });
          await controller.init();

          if (!action && req.method === "GET") {
            res.end(JSON.stringify(await controller.getGoalStatus()));
            return;
          }

          if (!action && req.method === "POST") {
            const data = await readJsonBody(req);
            const goal = await controller.setGoal(
              data.condition,
              {
                turnCount: Number(data.stats?.turnCount ?? 0),
                tokens: Number(data.stats?.tokens ?? 0),
              },
              {
                runner: "daemon",
                pending: true,
              }
            );
            res.end(JSON.stringify(goal));
            return;
          }

          if (action === "clear" && req.method === "POST") {
            const goal = await controller.clearGoal("daemon_api_clear");
            res.end(JSON.stringify(goal));
            return;
          }
        }
      }

      // 4. 健康检查
      if (url.pathname === "/health") {
        res.end(JSON.stringify({
          status: "ok",
          version: formatDaemonVersion(),
          pid: process.pid,
          uptimeMs: Date.now() - startedAt,
          missions: manager.listMissions().length,
          durableSupervisor: "running",
        }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not Found" }));

    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      res.writeHead(error.statusCode ?? 500);
      res.end(JSON.stringify({ error: error.message, code: error.code ?? "DAEMON_ERROR" }));
    }
  });

  server.listen(PORT, () => {
    console.log(`[qlingd] 守护进程已启动，监听端口: ${PORT}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

/** 后台执行使命逻辑 */
async function executeMissionInBackground(id: string, manager: MissionManager, stateDir: string, data: any) {
  const mission = manager.getMission(id);
  if (!mission) return;

  try {
    if (mission.status === "paused" || mission.status === "canceled") {
      await manager.appendLog(id, `使命未启动，当前状态为 ${mission.status}`, { source: "daemon" });
      return;
    }

    await manager.updateStatus(id, "running");
    await manager.appendLog(id, "使命开始执行", { source: "daemon" });

    // 重新加载配置
    const { config: loadedConfig } = await loadQlingConfig({});
    const { buildToolRegistry } = await import("./tools/index.js");

    const staticEnabled: Record<string, boolean> = {};
    for (const [name, cfg] of Object.entries(loadedConfig.tools)) {
      staticEnabled[name] = cfg.enabled;
    }
    const tools = buildToolRegistry({ staticEnabled });

    const agentConfig: any = {
      apiKey: loadedConfig.llm.api_key || process.env.QLING_LLM_API_KEY || "",
      provider: loadedConfig.llm.provider,
      endpoint: loadedConfig.llm.endpoint,
      model: loadedConfig.llm.model,
      maxIterations: loadedConfig.runtime.max_steps,
      tools,
      runtime: {
        workspaceDir: loadedConfig.runtime.workspace_dir || process.cwd(),
        fileCacheDir: loadedConfig.runtime.file_cache_dir,
        fileStateDir: stateDir,
      },
    };

    const agent = new AgentLoop(agentConfig);
    await agent.waitForInit();

    // v0.5 M3: 状态恢复 (High-fidelity Resume)
    if (data.checkpoint) {
      console.log(`[qlingd] 正在为使命 ${id} 恢复状态机快照...`);
       await manager.appendLog(id, "正在恢复状态机快照", { source: "daemon" });
       agent.syncWorkflowState(data.checkpoint);
       if (data.stats) {
          (agent as any).sessionTokens = data.stats.sessionTokens || 0;
       }
    } else {
       agent.addUserMessage(mission.description);
    }

    const result = await agent.run();

    await manager.appendLog(id, "使命执行成功", {
      source: "daemon",
      resultPreview: typeof result === "string" ? result.slice(0, 120) : String(result),
    });
    await manager.updateStatus(id, "succeeded");
    console.log(`[qlingd] 使命 ${id} 执行成功。`);
    await agent.shutdown();

  } catch (err) {
    await manager.updateStatus(id, "failed", {
      message: (err as Error).message,
      code: "DAEMON_EXEC_FAILED"
    });
    await manager.appendLog(id, `使命执行失败: ${(err as Error).message}`, { source: "daemon" });
    console.error(`[qlingd] 使命 ${id} 执行失败: ${(err as Error).message}`);
  }
}

function matchMissionRoute(pathname: string): { id: string; action: string | null } | null {
  const match = pathname.match(/^\/missions\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return null;
  return {
    id: decodeURIComponent(match[1]),
    action: match[2] ? decodeURIComponent(match[2]) : null,
  };
}

function matchSessionRoute(
  pathname: string
): { sessionId: string; resource: "loop-tasks" | "goal"; itemId: string | null; action: string | null } | null {
  const match = pathname.match(/^\/sessions\/([^/]+)\/(loop-tasks|goal)(?:\/([^/]+))?(?:\/([^/]+))?$/);
  if (!match) return null;
  const resource = match[2] as "loop-tasks" | "goal";
  let itemId = match[3] ? decodeURIComponent(match[3]) : null;
  let action = match[4] ? decodeURIComponent(match[4]) : null;
  if (resource === "goal" && itemId && !action) {
    action = itemId;
    itemId = null;
  }
  return {
    sessionId: decodeURIComponent(match[1]),
    resource,
    itemId,
    action,
  };
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

main().catch(console.error);
