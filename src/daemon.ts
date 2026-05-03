// ============================================================
// qinglingd - 轻灵后台守护进程 (v0.5 M3)
// 负责后台任务执行、队列管理与状态持久化
// ============================================================

import * as http from "http";
import { MissionManager } from "./mission/manager.js";
import { AgentLoop } from "./agent-loop.js";
import { loadQinglingConfig, applyConfigToProcessEnv } from "./config.js";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import dotenv from "dotenv";

const HOME_DIR = os.homedir();
const DEFAULT_STATE_DIR = path.join(HOME_DIR, ".qingling");

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
  const globalEnv = path.join(HOME_DIR, ".qingling", ".env");
  if (fs.existsSync(globalEnv)) {
    dotenv.config({ path: globalEnv });
  }
}

async function main() {
  loadEnv();
  
  const stateDir = process.env.QINGLING_FILE_STATE_DIR || DEFAULT_STATE_DIR;
  const manager = new MissionManager(stateDir);
  await manager.init();

  // 尝试预加载配置并应用到环境变量
  try {
    const { config } = await loadQinglingConfig({});
    applyConfigToProcessEnv(config);
  } catch (err) {
    console.error(`[qinglingd] Warning: Failed to load config: ${(err as Error).message}`);
  }

  const PORT = Number(process.env.QINGLING_DAEMON_PORT) || 9998;
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
        let body = "";
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body);
        const mission = await manager.createMission(data.name, data.description, data.sessionId);
        
        // 异步启动任务执行 (Detach) - 传入全量数据以支持状态恢复
        executeMissionInBackground(mission.id, manager, stateDir, data);
        
        res.end(JSON.stringify({ ok: true, missionId: mission.id }));
        return;
      }

      // 4. 健康检查
      if (url.pathname === "/health") {
        res.end(JSON.stringify({ status: "ok", version: "0.5.0-daemon" }));
        return;
      }

      res.writeHead(404).end(JSON.stringify({ error: "Not Found" }));

    } catch (err) {
      res.writeHead(500).end(JSON.stringify({ error: (err as Error).message }));
    }
  });

  server.listen(PORT, () => {
    console.log(`[qinglingd] 守护进程已启动，监听端口: ${PORT}`);
  });
}

/** 后台执行使命逻辑 */
async function executeMissionInBackground(id: string, manager: MissionManager, stateDir: string, data: any) {
  const mission = manager.getMission(id);
  if (!mission) return;

  try {
    await manager.updateStatus(id, "running");
    
    // 重新加载配置
    const { config: loadedConfig } = await loadQinglingConfig({});
    const { buildToolRegistry } = await import("./tools/index.js");

    const staticEnabled: Record<string, boolean> = {};
    for (const [name, cfg] of Object.entries(loadedConfig.tools)) {
      staticEnabled[name] = cfg.enabled;
    }
    const tools = buildToolRegistry({ staticEnabled });

    const agentConfig: any = {
      apiKey: loadedConfig.llm.api_key || process.env.QINGLING_LLM_API_KEY || "",
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
       console.log(`[qinglingd] 正在为使命 ${id} 恢复状态机快照...`);
       agent.syncWorkflowState(data.checkpoint);
       if (data.stats) {
          (agent as any).sessionTokens = data.stats.sessionTokens || 0;
       }
    } else {
       agent.addUserMessage(mission.description);
    }
    
    const result = await agent.run();
    
    await manager.updateStatus(id, "succeeded");
    console.log(`[qinglingd] 使命 ${id} 执行成功。`);
    await agent.shutdown();

  } catch (err) {
    await manager.updateStatus(id, "failed", {
      message: (err as Error).message,
      code: "DAEMON_EXEC_FAILED"
    });
    console.error(`[qinglingd] 使命 ${id} 执行失败: ${(err as Error).message}`);
  }
}

main().catch(console.error);
