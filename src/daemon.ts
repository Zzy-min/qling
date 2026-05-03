// ============================================================
// qinglingd - 轻灵后台守护进程 (v0.5 M3)
// 负责后台任务执行、队列管理与状态持久化
// ============================================================

import * as http from "http";
import { MissionManager } from "./mission/manager.js";
import { AgentLoop } from "./agent-loop.js";
import * as path from "path";
import * as os from "os";

const HOME_DIR = os.homedir();
const DEFAULT_STATE_DIR = path.join(HOME_DIR, ".qingling");
const PORT = Number(process.env.QINGLING_DAEMON_PORT) || 9998;

async function main() {
  const stateDir = process.env.QINGLING_FILE_STATE_DIR || DEFAULT_STATE_DIR;
  const manager = new MissionManager(stateDir);
  await manager.init();

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
        
        // 异步启动任务执行 (Detach)
        executeMissionInBackground(mission.id, manager, stateDir);
        
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
async function executeMissionInBackground(id: string, manager: MissionManager, stateDir: string) {
  const mission = manager.getMission(id);
  if (!mission) return;

  try {
    await manager.updateStatus(id, "running");
    
    // 初始化一个独立的 Agent 实例进行后台处理
    // 注意：这里需要根据 mission.sessionId 恢复上下文
    const agent = new AgentLoop({
      runtime: { fileStateDir: stateDir }
    } as any);
    await agent.waitForInit();
    
    agent.addUserMessage(mission.description);
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
