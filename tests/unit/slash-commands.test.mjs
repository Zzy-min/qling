import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleSlashCommand } from "../../dist/commands/index.js";
import { MissionManager } from "../../dist/mission/manager.js";

async function withEnv(patch, fn) {
  const prev = {};
  for (const key of Object.keys(patch)) {
    prev[key] = process.env[key];
    const value = patch[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "qingling-slash-loop-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createContext(overrides = {}) {
  const lines = [];
  const errors = [];
  const ctx = {
    agentLoop: {
      compactSessionNow: async () => ({ beforeCount: 12, afterCount: 6, changed: true }),
      reset: () => {},
      getSessionId: () => "session-test",
      getSessionStats: () => ({ sessionId: "session-test", turnCount: 3, tokens: 1234, compactions: 0 }),
      getWorkflowRuntime: () => ({ getCheckpoint: () => null }),
      ...overrides.agentLoop,
    },
    scheduler: {
      createLoopTask: async () => ({ id: "tsk_loop_1", prompt: "检查构建", intervalMs: 60_000, mode: "fixed" }),
      listTasks: async () => [],
      cancelTask: async (id) => ({ id, status: "canceled" }),
      cancelAllTasks: async () => 0,
      ...overrides.scheduler,
    },
    goalController: {
      setGoal: async (condition, stats, options) => ({ condition, status: "active", baselineTurns: stats.turnCount, runner: options?.runner ?? "session" }),
      clearGoal: async () => ({ status: "cleared" }),
      getGoalStatus: async () => null,
      buildInitialPrompt: (condition) => `目标条件: ${condition}`,
      ...overrides.goalController,
    },
    listSavedSessions: overrides.listSavedSessions ?? (async () => []),
    switchSession: overrides.switchSession ?? (async () => null),
    workspaceDir: overrides.workspaceDir,
    homeDir: overrides.homeDir,
    daemonSessionApi: overrides.daemonSessionApi,
    statusLine: overrides.statusLine,
    setImmediatePrompt: overrides.setImmediatePrompt ?? (() => {}),
    writeLine: (line = "") => {
      lines.push(String(line));
    },
    writeError: (line = "") => {
      errors.push(String(line));
    },
  };
  return { ctx, lines, errors };
}

test("slash help includes loop/tasks/compact", async () => {
  const { ctx, lines } = createContext();
  const handled = await handleSlashCommand("/help", ctx);
  assert.equal(handled, true);
  const joined = lines.join("\n");
  assert.match(joined, /\/loop/);
  assert.match(joined, /\/tasks/);
  assert.match(joined, /\/agents/);
  assert.match(joined, /\/mission/);
  assert.match(joined, /\/compact/);
  assert.match(joined, /\/goal/);
  assert.match(joined, /\/sessions/);
  assert.match(joined, /\/resume/);
  assert.match(joined, /\/permissions/);
  assert.match(joined, /\/permissions explain/);
  assert.match(joined, /\/statusline/);
  assert.match(joined, /\/recap/);
  assert.match(joined, /\/privacy/);
  assert.match(joined, /\/shortcuts/);
  assert.match(joined, /\/queue/);
  assert.match(joined, /\/export/);
  assert.match(joined, /\/exports/);
  assert.match(joined, /\/storage/);
  assert.match(joined, /\/doctor/);
  assert.match(joined, /\/context/);
  assert.match(joined, /\/mcp/);
  assert.match(joined, /\/外部工具/);
  assert.match(joined, /\/hooks/);
  assert.match(joined, /\/钩子/);
  assert.match(joined, /\/memory/);
  assert.match(joined, /\/memory search/);
  assert.match(joined, /\/memory practices/);
  assert.match(joined, /\/memory graph/);
  assert.match(joined, /\/记忆/);
});

test("slash help topic shows focused local command help", async () => {
  const { ctx, lines } = createContext();
  const handled = await handleSlashCommand("/help exports", ctx);

  assert.equal(handled, true);
  const joined = lines.join("\n");
  assert.match(joined, /聚焦帮助/);
  assert.match(joined, /Topic\s*: exports/);
  assert.match(joined, /Usage\s*: \/exports \[count\]/);
  assert.match(joined, /Aliases\s*: \/导出列表/);
  assert.match(joined, /只读取本地文件元数据/);
});

test("slash command help flag shows focused local command help", async () => {
  const { ctx, lines } = createContext();
  const handled = await handleSlashCommand("/exports --help", ctx);

  assert.equal(handled, true);
  const joined = lines.join("\n");
  assert.match(joined, /聚焦帮助/);
  assert.match(joined, /Topic\s*: exports/);
  assert.match(joined, /Usage\s*: \/exports \[count\]/);
  assert.doesNotMatch(joined, /Dir\s*:/);
  assert.doesNotMatch(joined, /Count\s*:/);
  assert.doesNotMatch(joined, /Status\s*:/);
});

test("slash chinese command help flag shows focused local command help", async () => {
  const { ctx, lines } = createContext();
  const handled = await handleSlashCommand("/导出列表 -h", ctx);

  assert.equal(handled, true);
  const joined = lines.join("\n");
  assert.match(joined, /聚焦帮助/);
  assert.match(joined, /Topic\s*: exports/);
  assert.match(joined, /Usage\s*: \/exports \[count\]/);
  assert.doesNotMatch(joined, /Dir\s*:/);
  assert.doesNotMatch(joined, /Count\s*:/);
  assert.doesNotMatch(joined, /Status\s*:/);
});

test("slash unknown command help flag uses focused typo suggestion", async () => {
  const { ctx, lines, errors } = createContext();
  const handled = await handleSlashCommand("/expors --help", ctx);

  assert.equal(handled, true);
  assert.equal(errors.length, 0);
  const joined = lines.join("\n");
  assert.match(joined, /未找到帮助主题 "expors"/);
  assert.match(joined, /你是不是想看/);
  assert.match(joined, /\/help exports/);
  assert.match(joined, /Usage\s*: \/exports \[count\]/);
});

test("slash question-mark help topic accepts chinese alias", async () => {
  const { ctx, lines } = createContext();
  const handled = await handleSlashCommand("/? 权限", ctx);

  assert.equal(handled, true);
  const joined = lines.join("\n");
  assert.match(joined, /聚焦帮助/);
  assert.match(joined, /Topic\s*: permissions/);
  assert.match(joined, /\/permissions explain <tool>/);
  assert.match(joined, /\/权限 解释 <tool>/);
});

test("slash unknown command suggests nearest english command", async () => {
  const { ctx, errors } = createContext();
  const handled = await handleSlashCommand("/expors", ctx);

  assert.equal(handled, true);
  const joined = errors.join("\n");
  assert.match(joined, /未知指令/);
  assert.match(joined, /\/exports/);
  assert.match(joined, /\/help exports/);
});

test("slash unknown command suggests nearest chinese alias", async () => {
  const { ctx, errors } = createContext();
  const handled = await handleSlashCommand("/导出列", ctx);

  assert.equal(handled, true);
  const joined = errors.join("\n");
  assert.match(joined, /未知指令/);
  assert.match(joined, /\/导出列表/);
  assert.match(joined, /\/help 导出列表/);
});

test("slash unknown command falls back without weak suggestions", async () => {
  const { ctx, errors } = createContext();
  const handled = await handleSlashCommand("/zzzzzz", ctx);

  assert.equal(handled, true);
  const joined = errors.join("\n");
  assert.match(joined, /未知指令/);
  assert.match(joined, /\/help/);
  assert.doesNotMatch(joined, /你是不是想用/);
});

test("slash memory lists local persisted memory without reading sessions", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "memory"), { recursive: true });
    await writeFile(
      join(root, "memory", "memory.json"),
      JSON.stringify(
        [
          {
            id: "mem_slash_1",
            content: "slash local memory",
            source: "manual",
            createdAt: 2_000,
            importance: 0.7,
          },
        ],
        null,
        2
      ),
      "utf8"
    );
    await mkdir(join(root, "sessions"), { recursive: true });
    await writeFile(join(root, "sessions", "session.json"), "SECRET_SLASH_MEMORY_SESSION_BODY", "utf8");

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });

    const handled = await handleSlashCommand("/memory 5", ctx);

    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /本地记忆/);
    assert.match(joined, /mem_slash_1/);
    assert.doesNotMatch(joined, /SECRET_SLASH_MEMORY_SESSION_BODY/);
  });
});

test("slash memory chinese alias shows local memory entry detail", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "memory"), { recursive: true });
    await writeFile(
      join(root, "memory", "memory.json"),
      JSON.stringify(
        [
          {
            id: "mem_slash_show",
            content: "中文记忆详情",
            source: "manual",
            createdAt: 2_000,
            importance: 0.7,
          },
        ],
        null,
        2
      ),
      "utf8"
    );

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });

    const handled = await handleSlashCommand("/记忆 查看 mem_slash_show", ctx);

    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /mem_slash_show/);
    assert.match(joined, /中文记忆详情/);
  });
});

test("slash memory search lists explainable local matches without reading sessions", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "memory"), { recursive: true });
    await writeFile(
      join(root, "memory", "memory.json"),
      JSON.stringify(
        [
          {
            id: "mem_slash_search",
            content: "slash search local permission memory",
            source: "manual",
            createdAt: 2_000,
            importance: 0.7,
          },
        ],
        null,
        2
      ),
      "utf8"
    );
    await mkdir(join(root, "sessions"), { recursive: true });
    await writeFile(join(root, "sessions", "session.json"), "SECRET_SLASH_MEMORY_SEARCH_SESSION_BODY", "utf8");

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });

    const handled = await handleSlashCommand("/memory search permission 5", ctx);

    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /本地记忆搜索/);
    assert.match(joined, /mem_slash_search/);
    assert.match(joined, /content:permission/);
    assert.doesNotMatch(joined, /SECRET_SLASH_MEMORY_SEARCH_SESSION_BODY/);
  });
});

test("slash memory chinese search alias lists local matches", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "memory"), { recursive: true });
    await writeFile(
      join(root, "memory", "memory.json"),
      JSON.stringify(
        [
          {
            id: "mem_slash_search_cn",
            content: "中文搜索匹配",
            source: "manual",
            createdAt: 2_000,
            importance: 0.7,
          },
        ],
        null,
        2
      ),
      "utf8"
    );

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });

    const handled = await handleSlashCommand("/记忆 搜索 中文搜索 1", ctx);

    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /mem_slash_search_cn/);
    assert.match(joined, /content:phrase/);
  });
});

test("slash memory practices lists local distilled practices without reading sessions", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "memory"), { recursive: true });
    await mkdir(join(root, "sessions"), { recursive: true });
    await writeFile(join(root, "sessions", "session.json"), "SECRET_SLASH_MEMORY_PRACTICE_SESSION_BODY", "utf8");

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(join(root, "memory", "cognitive_knowledge.db"));
    try {
      db.exec(`
        CREATE TABLE distilled_practices (
          id TEXT PRIMARY KEY,
          task_pattern TEXT NOT NULL,
          action_json TEXT NOT NULL,
          context_json TEXT NOT NULL,
          confidence REAL DEFAULT 1.0,
          hit_count INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL
        );
        INSERT INTO distilled_practices (id, task_pattern, action_json, context_json, confidence, hit_count, created_at)
        VALUES ('prac_slash', 'slash practice', '["npm run build"]', '["src/commands/memory.ts"]', 0.8, 3, 2000);
      `);
    } finally {
      db.close();
    }

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });

    const handled = await handleSlashCommand("/memory practices 5", ctx);

    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /本地蒸馏实践/);
    assert.match(joined, /prac_slash/);
    assert.match(joined, /slash practice/);
    assert.doesNotMatch(joined, /SECRET_SLASH_MEMORY_PRACTICE_SESSION_BODY/);
  });
});

test("slash memory chinese practices alias lists local distilled practices", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "memory"), { recursive: true });
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(join(root, "memory", "cognitive_knowledge.db"));
    try {
      db.exec(`
        CREATE TABLE distilled_practices (
          id TEXT PRIMARY KEY,
          task_pattern TEXT NOT NULL,
          action_json TEXT NOT NULL,
          context_json TEXT NOT NULL,
          confidence REAL DEFAULT 1.0,
          hit_count INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL
        );
        INSERT INTO distilled_practices (id, task_pattern, action_json, context_json, confidence, hit_count, created_at)
        VALUES ('prac_slash_cn', '中文实践', '["运行测试"]', '["src/memory-report.ts"]', 0.9, 4, 3000);
      `);
    } finally {
      db.close();
    }

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });

    const handled = await handleSlashCommand("/记忆 经验 1", ctx);

    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /prac_slash_cn/);
    assert.match(joined, /中文实践/);
  });
});

test("slash memory graph lists local kg nodes without reading sessions", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "memory"), { recursive: true });
    await mkdir(join(root, "sessions"), { recursive: true });
    await writeFile(join(root, "sessions", "session.json"), "SECRET_SLASH_MEMORY_GRAPH_SESSION_BODY", "utf8");

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(join(root, "memory", "cognitive_knowledge.db"));
    try {
      db.exec(`
        CREATE TABLE kg_nodes (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          label TEXT NOT NULL,
          metadata TEXT,
          last_seen INTEGER NOT NULL
        );
        CREATE TABLE kg_edges (
          source TEXT NOT NULL,
          target TEXT NOT NULL,
          relation TEXT NOT NULL,
          weight REAL DEFAULT 1.0,
          PRIMARY KEY (source, target, relation)
        );
        INSERT INTO kg_nodes (id, type, label, metadata, last_seen)
        VALUES
          ('kg_slash_task', 'task', 'slash graph task', '{"secret":"hidden"}', 3000),
          ('kg_slash_file', 'file', 'src/commands/memory.ts', '{}', 2000);
        INSERT INTO kg_edges (source, target, relation, weight)
        VALUES ('kg_slash_task', 'kg_slash_file', 'reads', 1.0);
      `);
    } finally {
      db.close();
    }

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });

    const handled = await handleSlashCommand("/memory graph 5", ctx);

    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /本地知识图谱/);
    assert.match(joined, /kg_slash_task/);
    assert.match(joined, /slash graph task/);
    assert.match(joined, /reads -> src\/commands\/memory\.ts/);
    assert.doesNotMatch(joined, /hidden/);
    assert.doesNotMatch(joined, /SECRET_SLASH_MEMORY_GRAPH_SESSION_BODY/);
  });
});

test("slash memory chinese graph alias lists local kg nodes", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "memory"), { recursive: true });
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(join(root, "memory", "cognitive_knowledge.db"));
    try {
      db.exec(`
        CREATE TABLE kg_nodes (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          label TEXT NOT NULL,
          metadata TEXT,
          last_seen INTEGER NOT NULL
        );
        CREATE TABLE kg_edges (
          source TEXT NOT NULL,
          target TEXT NOT NULL,
          relation TEXT NOT NULL,
          weight REAL DEFAULT 1.0,
          PRIMARY KEY (source, target, relation)
        );
        INSERT INTO kg_nodes (id, type, label, metadata, last_seen)
        VALUES ('kg_slash_cn', 'technology', '中文图谱节点', '{}', 3000);
      `);
    } finally {
      db.close();
    }

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });

    const handled = await handleSlashCommand("/记忆 图谱 1", ctx);

    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /kg_slash_cn/);
    assert.match(joined, /中文图谱节点/);
  });
});

test("slash agents lists local missions without reading session bodies", async () => {
  await withTempDir(async (root) => {
    const manager = new MissionManager(root);
    await manager.init();
    const mission = await manager.createMission("Seeded Agent", "background task summary", "session-secret");
    await writeFile(join(root, "sessions", "session-secret.json"), "SECRET_SLASH_AGENT_SESSION_BODY", "utf8").catch(async () => {
      await mkdir(join(root, "sessions"), { recursive: true });
      await writeFile(join(root, "sessions", "session-secret.json"), "SECRET_SLASH_AGENT_SESSION_BODY", "utf8");
    });

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });

    const handled = await handleSlashCommand("/agents", ctx);

    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /Agents/);
    assert.match(joined, /Working/);
    assert.match(joined, new RegExp(mission.id));
    assert.match(joined, /Seeded Agent/);
    assert.doesNotMatch(joined, /SECRET_SLASH_AGENT_SESSION_BODY/);
  });
});

test("slash agents chinese alias lists local missions", async () => {
  await withTempDir(async (root) => {
    const manager = new MissionManager(root);
    await manager.init();
    const mission = await manager.createMission("中文代理任务", "中文后台任务摘要", "session-cn");

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });

    const handled = await handleSlashCommand("/代理", ctx);

    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /Agents/);
    assert.match(joined, new RegExp(mission.id));
    assert.match(joined, /中文代理任务/);
  });
});

test("slash mission show prints local mission detail without reading session body", async () => {
  await withTempDir(async (root) => {
    const manager = new MissionManager(root);
    await manager.init();
    const mission = await manager.createMission("Show Mission", "show mission description", "session-secret");
    await mkdir(join(root, "sessions"), { recursive: true });
    await writeFile(join(root, "sessions", "session-secret.json"), "SECRET_SLASH_MISSION_SESSION_BODY", "utf8");

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });

    const handled = await handleSlashCommand(`/mission show ${mission.id}`, ctx);

    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /使命详情/);
    assert.match(joined, new RegExp(mission.id));
    assert.match(joined, /Show Mission/);
    assert.match(joined, /show mission description/);
    assert.doesNotMatch(joined, /SECRET_SLASH_MISSION_SESSION_BODY/);
  });
});

test("slash mission logs prints local mission events", async () => {
  await withTempDir(async (root) => {
    const manager = new MissionManager(root);
    await manager.init();
    const mission = await manager.createMission("Log Mission", "log mission description", "session-log");
    await manager.appendLog(mission.id, "local mission log line", { source: "test" });

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });

    const handled = await handleSlashCommand(`/mission logs ${mission.id}`, ctx);

    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /local mission log line/);
  });
});

test("slash mission terminate cancels local mission through state machine", async () => {
  await withTempDir(async (root) => {
    const manager = new MissionManager(root);
    await manager.init();
    const mission = await manager.createMission("Terminate Mission", "terminate mission description", "session-term");

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });

    const handled = await handleSlashCommand(`/mission terminate ${mission.id}`, ctx);

    assert.equal(handled, true);
    assert.match(lines.join("\n"), /canceled/i);

    const verifier = new MissionManager(root);
    await verifier.init();
    assert.equal(verifier.getMissionOrThrow(mission.id).status, "canceled");
  });
});

test("slash mission chinese alias shows local mission detail", async () => {
  await withTempDir(async (root) => {
    const manager = new MissionManager(root);
    await manager.init();
    const mission = await manager.createMission("中文使命", "中文使命描述", "session-cn-mission");

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });

    const handled = await handleSlashCommand(`/使命 查看 ${mission.id}`, ctx);

    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /使命详情/);
    assert.match(joined, /中文使命/);
    assert.match(joined, new RegExp(mission.id));
  });
});

test("slash context prints local context report", async () => {
  const { ctx, lines } = createContext({
    agentLoop: {
      getMessagesSnapshot: () => [{ role: "user", content: "hello" }],
      getRuntimeRootDir: () => "C:\\Users\\Lenovo\\.qingling",
      getWorkspaceDir: () => "C:\\repo\\qingling",
    },
    listSavedSessions: async () => [],
  });
  const handled = await handleSlashCommand("/context", ctx);
  assert.equal(handled, true);
  const joined = lines.join("\n");
  assert.match(joined, /上下文|Context/);
  assert.match(joined, /session-test/);
  assert.match(joined, /本地/);
});

test("slash context chinese alias prints local context report", async () => {
  const { ctx, lines } = createContext({
    agentLoop: {
      getMessagesSnapshot: () => [{ role: "user", content: "hello" }],
      getRuntimeRootDir: () => "C:\\Users\\Lenovo\\.qingling",
      getWorkspaceDir: () => "C:\\repo\\qingling",
    },
    listSavedSessions: async () => [],
  });
  const handled = await handleSlashCommand("/上下文", ctx);
  assert.equal(handled, true);
  assert.match(lines.join("\n"), /session-test/);
});

test("slash mcp prints local mcp report without leaking secrets", async () => {
  await withEnv(
    {
      QINGLING_MCP_CONNECTION_TIMEOUT_MS: "1234",
      QINGLING_MCP_CALL_TIMEOUT_MS: "5678",
      QINGLING_MCP_SERVERS: JSON.stringify({
        docs: {
          command: "",
          args: [],
          enabled: true,
          transport: "http",
          url: "https://user:pass@example.com/mcp?token=secret#frag",
          headers: {
            Authorization: "Bearer slash-secret",
          },
        },
      }),
    },
    async () => {
      const { ctx, lines } = createContext();
      const handled = await handleSlashCommand("/mcp", ctx);

      assert.equal(handled, true);
      const joined = lines.join("\n");
      assert.match(joined, /本地 MCP 配置/);
      assert.match(joined, /Servers\s*: enabled=1\/1/);
      assert.match(joined, /connect=1234ms call=5678ms/);
      assert.match(joined, /docs/);
      assert.match(joined, /url=https:\/\/example\.com\/mcp/);
      assert.match(joined, /Authorization=set\(redacted\)/);
      assert.doesNotMatch(joined, /slash-secret/);
      assert.doesNotMatch(joined, /user:pass/);
      assert.doesNotMatch(joined, /token=secret/);
    }
  );
});

test("slash mcp chinese alias prints local mcp report", async () => {
  await withEnv(
    {
      QINGLING_MCP_SERVERS: JSON.stringify({
        local: {
          command: "node",
          args: ["server.js"],
          enabled: true,
          transport: "stdio",
          env: {
            MCP_TOKEN: "secret",
          },
        },
      }),
    },
    async () => {
      const { ctx, lines } = createContext();
      const handled = await handleSlashCommand("/外部工具", ctx);

      assert.equal(handled, true);
      const joined = lines.join("\n");
      assert.match(joined, /local/);
      assert.match(joined, /command=node/);
      assert.match(joined, /MCP_TOKEN=set\(redacted\)/);
      assert.doesNotMatch(joined, /secret/);
    }
  );
});

test("slash hooks prints local hooks report without leaking custom patterns", async () => {
  await withEnv(
    {
      QINGLING_GUARD_ENABLED: "true",
      QINGLING_GUARD_RATE_LIMIT_ENABLED: "true",
      QINGLING_GUARD_RATE_LIMIT_MAX_PER_MINUTE: "7",
      QINGLING_GUARD_CONTENT_FILTER_ENABLED: "true",
      QINGLING_GUARD_CONTENT_FILTER_PII: "true",
      QINGLING_GUARD_CONTENT_FILTER_INJECTION: "false",
      QINGLING_GUARD_CONTENT_FILTER_CUSTOM: JSON.stringify(["SECRET_SLASH_PATTERN"]),
      QINGLING_GUARD_PERMISSIONS_DEFAULT: "ask",
      QINGLING_GUARD_PERMISSIONS_RULES: JSON.stringify([
        { tool_pattern: "bash", decision: "deny", reason: "SECRET_REASON" },
      ]),
    },
    async () => {
      const { ctx, lines } = createContext();
      const handled = await handleSlashCommand("/hooks", ctx);

      assert.equal(handled, true);
      const joined = lines.join("\n");
      assert.match(joined, /本地 Hooks 状态/);
      assert.match(joined, /Guard\s*: on/);
      assert.match(joined, /permission=ask rules=1/);
      assert.match(joined, /rate_limit=on\(7\/min\)/);
      assert.match(joined, /content_filter=on pii=on injection=off custom=1/);
      assert.doesNotMatch(joined, /SECRET_SLASH_PATTERN/);
      assert.doesNotMatch(joined, /SECRET_REASON/);
    }
  );
});

test("slash hooks chinese alias prints local hooks report", async () => {
  const { ctx, lines } = createContext();
  const handled = await handleSlashCommand("/钩子", ctx);

  assert.equal(handled, true);
  assert.match(lines.join("\n"), /本地 Hooks 状态/);
});

test("slash recap prints local session summary", async () => {
  const { ctx, lines } = createContext({
    agentLoop: {
      getMessagesSnapshot: () => [
        { role: "user", content: "请实现 recap" },
        { role: "assistant", content: "开始处理" },
      ],
      getWorkspaceDir: () => "C:\\repo\\qingling",
    },
    goalController: {
      getGoalStatus: async () => ({ status: "active", condition: "测试通过" }),
    },
    scheduler: {
      listTasks: async () => [{ id: "tsk_1", status: "active", prompt: "检查构建" }],
    },
  });
  const handled = await handleSlashCommand("/recap 1", ctx);
  assert.equal(handled, true);
  const joined = lines.join("\n");
  assert.match(joined, /本地会话回顾/);
  assert.match(joined, /assistant: 开始处理/);
  assert.doesNotMatch(joined, /user: 请实现 recap/);
  assert.match(joined, /goal=active/);
});

test("slash recap chinese alias prints local session summary", async () => {
  const { ctx, lines } = createContext({
    agentLoop: {
      getMessagesSnapshot: () => [{ role: "user", content: "回顾一下" }],
      getWorkspaceDir: () => "C:\\repo\\qingling",
    },
  });
  const handled = await handleSlashCommand("/回顾", ctx);
  assert.equal(handled, true);
  assert.match(lines.join("\n"), /回顾一下/);
});

test("slash privacy prints local data retention report", async () => {
  const { ctx, lines } = createContext({
    agentLoop: {
      getRuntimeRootDir: () => "C:\\Users\\Lenovo\\.qingling",
      getWorkspaceDir: () => "C:\\repo\\qingling",
      getModel: () => "deepseek-chat",
    },
    listSavedSessions: async () => [{ name: "session-1", sessionId: "session-1" }],
  });
  const handled = await handleSlashCommand("/privacy", ctx);
  assert.equal(handled, true);
  const joined = lines.join("\n");
  assert.match(joined, /本地数据留存/);
  assert.match(joined, /C:\\repo\\qingling/);
  assert.match(joined, /已存快照\s*: 1/);
  assert.match(joined, /模型请求仍按 provider 配置发送/);
});

test("slash privacy chinese alias prints local data retention report", async () => {
  const { ctx, lines } = createContext({
    agentLoop: {
      getRuntimeRootDir: () => "C:\\Users\\Lenovo\\.qingling",
      getWorkspaceDir: () => "C:\\repo\\qingling",
    },
  });
  const handled = await handleSlashCommand("/隐私", ctx);
  assert.equal(handled, true);
  assert.match(lines.join("\n"), /本地数据留存/);
});

test("slash storage prints local storage report without reading bodies", async () => {
  const root = await mkdtemp(join(tmpdir(), "qingling-slash-storage-"));
  try {
    await mkdir(join(root, "sessions"), { recursive: true });
    await writeFile(join(root, "sessions", "session.json"), "SECRET_STORAGE_BODY", "utf8");
    await withEnv(
      {
        QINGLING_FILE_STATE_DIR: undefined,
        QINGLING_FILE_CACHE_DIR: undefined,
      },
      async () => {
        const { ctx, lines } = createContext({
          agentLoop: {
            getRuntimeRootDir: () => root,
            getWorkspaceDir: () => "C:\\repo\\qingling",
          },
        });
        const handled = await handleSlashCommand("/storage", ctx);
        assert.equal(handled, true);
        const joined = lines.join("\n");
        assert.match(joined, /本地存储盘点/);
        assert.match(joined, /sessions/);
        assert.match(joined, /Files\s*:/);
        assert.match(joined, /Size\s*:/);
        assert.doesNotMatch(joined, /SECRET_STORAGE_BODY/);
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("slash storage chinese alias prints local storage report", async () => {
  const root = await mkdtemp(join(tmpdir(), "qingling-slash-storage-cn-"));
  try {
    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
        getWorkspaceDir: () => "C:\\repo\\qingling",
      },
    });
    const handled = await handleSlashCommand("/存储", ctx);
    assert.equal(handled, true);
    assert.match(lines.join("\n"), /本地存储盘点/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("slash shortcuts prints tui shortcut help", async () => {
  const { ctx, lines } = createContext();
  const handled = await handleSlashCommand("/shortcuts", ctx);
  assert.equal(handled, true);
  const joined = lines.join("\n");
  assert.match(joined, /快捷键/);
  assert.match(joined, /Ctrl\+N/);
  assert.match(joined, /Ctrl\+R/);
  assert.match(joined, /Ctrl\+C/);
  assert.match(joined, /\/queue/);
  assert.match(joined, /\/queue clear/);
  assert.match(joined, /本地 TUI 输入缓冲/);
});

test("slash shortcuts chinese alias prints tui shortcut help", async () => {
  const { ctx, lines } = createContext();
  const handled = await handleSlashCommand("/快捷键", ctx);
  assert.equal(handled, true);
  assert.match(lines.join("\n"), /Ctrl\+N/);
});

test("slash export writes local markdown file", async () => {
  const root = await mkdtemp(join(tmpdir(), "qingling-slash-export-"));
  try {
    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
        getWorkspaceDir: () => "C:\\repo\\qingling",
        getMessagesSnapshot: () => [{ role: "user", content: "导出 slash 测试" }],
        getSessionStats: () => ({ sessionId: "session-test", turnCount: 1, tokens: 10, compactions: 0 }),
      },
    });
    const handled = await handleSlashCommand("/export", ctx);
    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /已导出/);
    assert.match(joined, /exports/);
    assert.match(joined, /\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("slash export chinese alias writes local markdown file", async () => {
  const root = await mkdtemp(join(tmpdir(), "qingling-slash-export-cn-"));
  try {
    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
        getWorkspaceDir: () => "C:\\repo\\qingling",
        getMessagesSnapshot: () => [{ role: "user", content: "中文导出" }],
        getSessionStats: () => ({ sessionId: "session-cn", turnCount: 1, tokens: 10, compactions: 0 }),
      },
    });
    const handled = await handleSlashCommand("/导出", ctx);
    assert.equal(handled, true);
    assert.match(lines.join("\n"), /已导出/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("slash exports lists local markdown exports without reading bodies", async () => {
  const root = await mkdtemp(join(tmpdir(), "qingling-slash-exports-"));
  try {
    const exportsDir = join(root, "exports");
    await mkdir(exportsDir, { recursive: true });
    const exportPath = join(exportsDir, "session-new.md");
    await writeFile(exportPath, "SECRET_SLASH_EXPORT_BODY", "utf8");
    await utimes(exportPath, new Date("2026-05-31T02:00:00.000Z"), new Date("2026-05-31T02:00:00.000Z"));

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });
    const handled = await handleSlashCommand("/exports", ctx);

    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /本地导出列表/);
    assert.match(joined, /session-new\.md/);
    assert.match(joined, /文件名\s*:/);
    assert.match(joined, /修改时间\s*:/);
    assert.match(joined, /大小\s*:/);
    assert.match(joined, /绝对路径\s*:/);
    assert.doesNotMatch(joined, /SECRET_SLASH_EXPORT_BODY/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("slash exports chinese alias lists local markdown exports", async () => {
  const root = await mkdtemp(join(tmpdir(), "qingling-slash-exports-cn-"));
  try {
    const exportsDir = join(root, "exports");
    await mkdir(exportsDir, { recursive: true });
    const exportPath = join(exportsDir, "session-cn.md");
    await writeFile(exportPath, "中文正文不应出现在列表", "utf8");

    const { ctx, lines } = createContext({
      agentLoop: {
        getRuntimeRootDir: () => root,
      },
    });
    const handled = await handleSlashCommand("/导出列表 1", ctx);

    assert.equal(handled, true);
    const joined = lines.join("\n");
    assert.match(joined, /session-cn\.md/);
    assert.doesNotMatch(joined, /中文正文不应出现在列表/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("slash doctor prints local diagnostics", async () => {
  const { ctx, lines } = createContext();
  const handled = await handleSlashCommand("/doctor", ctx);
  assert.equal(handled, true);
  const joined = lines.join("\n");
  assert.match(joined, /Doctor|诊断/);
  assert.match(joined, /workspace/);
});

test("slash doctor chinese alias prints local diagnostics", async () => {
  const { ctx, lines } = createContext();
  const handled = await handleSlashCommand("/诊断", ctx);
  assert.equal(handled, true);
  assert.match(lines.join("\n"), /Doctor|诊断/);
});

test("slash statusline shows current compact status", async () => {
  const { ctx, lines } = createContext({
    statusLine: {
      enabled: true,
      setEnabled: () => {},
      getLine: async () => "model=deepseek-chat session=session-1 branch=main",
    },
  });
  const handled = await handleSlashCommand("/statusline", ctx);
  assert.equal(handled, true);
  assert.match(lines.join("\n"), /model=deepseek-chat/);
});

test("slash statusline fallback shows context usage and local cost estimate without secrets", async () => {
  await withEnv(
    {
      QINGLING_STATUSLINE_COST_PER_1K_TOKENS: "0.002",
      QINGLING_LLM_API_KEY: "sk-statusline-secret",
    },
    async () => {
      const { ctx, lines } = createContext({
        agentLoop: {
          getModel: () => "deepseek-chat",
          getSessionStats: () => ({ sessionId: "session-status-cost", turnCount: 2, tokens: 12000, compactions: 0 }),
          getTokenBudget: () => ({ maxTokens: 120000 }),
          getPermissionMode: () => "ask",
        },
      });

      const handled = await handleSlashCommand("/statusline", ctx);

      assert.equal(handled, true);
      const joined = lines.join("\n");
      assert.match(joined, /ctx=12,000\/120,000\(10%\)/);
      assert.match(joined, /cost≈\$0\.0240/);
      assert.doesNotMatch(joined, /sk-statusline-secret/);
    }
  );
});

test("slash statusline off disables prompt statusline", async () => {
  let enabled = true;
  const { ctx, lines } = createContext({
    statusLine: {
      enabled,
      setEnabled: (next) => {
        enabled = next;
      },
      getLine: async () => "model=deepseek-chat session=session-1",
    },
  });
  const handled = await handleSlashCommand("/statusline off", ctx);
  assert.equal(handled, true);
  assert.equal(enabled, false);
  assert.match(lines.join("\n"), /关闭|off/i);
});

test("slash statusline on enables prompt statusline", async () => {
  let enabled = false;
  const { ctx, lines } = createContext({
    statusLine: {
      enabled,
      setEnabled: (next) => {
        enabled = next;
      },
      getLine: async () => "model=deepseek-chat session=session-1",
    },
  });
  const handled = await handleSlashCommand("/statusline on", ctx);
  assert.equal(handled, true);
  assert.equal(enabled, true);
  assert.match(lines.join("\n"), /开启|on/i);
});

test("slash statusline chinese alias shows current status", async () => {
  const { ctx, lines } = createContext({
    statusLine: {
      enabled: true,
      setEnabled: () => {},
      getLine: async () => "model=deepseek-chat session=session-1 branch=main",
    },
  });
  const handled = await handleSlashCommand("/状态线", ctx);
  assert.equal(handled, true);
  assert.match(lines.join("\n"), /session=session-1/);
});

test("slash compact delegates to agent loop compact API", async () => {
  let called = false;
  const { ctx, lines } = createContext({
    agentLoop: {
      compactSessionNow: async () => {
        called = true;
        return { beforeCount: 10, afterCount: 4, changed: true };
      },
    },
  });
  const handled = await handleSlashCommand("/compact", ctx);
  assert.equal(handled, true);
  assert.equal(called, true);
  assert.match(lines.join("\n"), /10/);
  assert.match(lines.join("\n"), /4/);
});

test("slash tasks cancel delegates to scheduler", async () => {
  let canceledId = null;
  const { ctx, lines } = createContext({
    scheduler: {
      cancelTask: async (id) => {
        canceledId = id;
        return { id, status: "canceled" };
      },
    },
  });
  const handled = await handleSlashCommand("/tasks cancel tsk_loop_9", ctx);
  assert.equal(handled, true);
  assert.equal(canceledId, "tsk_loop_9");
  assert.match(lines.join("\n"), /tsk_loop_9/);
});

test("slash goal set delegates to goal controller and requests immediate prompt", async () => {
  let conditionSeen = null;
  let immediatePrompt = null;
  const { ctx, lines } = createContext({
    goalController: {
      setGoal: async (condition) => {
        conditionSeen = condition;
        return { condition, status: "active" };
      },
      buildInitialPrompt: (condition) => `目标条件: ${condition}`,
    },
    setImmediatePrompt: (prompt) => {
      immediatePrompt = prompt;
    },
  });
  const handled = await handleSlashCommand("/goal 所有 auth 测试通过", ctx);
  assert.equal(handled, true);
  assert.equal(conditionSeen, "所有 auth 测试通过");
  assert.equal(immediatePrompt, "目标条件: 所有 auth 测试通过");
  assert.match(lines.join("\n"), /Goal|goal|目标/);
});

test("slash goal clear delegates to goal controller", async () => {
  let cleared = false;
  const { ctx, lines } = createContext({
    goalController: {
      clearGoal: async () => {
        cleared = true;
        return { status: "cleared", condition: "旧目标" };
      },
    },
  });
  const handled = await handleSlashCommand("/goal clear", ctx);
  assert.equal(handled, true);
  assert.equal(cleared, true);
  assert.match(lines.join("\n"), /clear|清除|停止/);
});

test("slash goal chinese alias delegates to goal controller", async () => {
  let conditionSeen = null;
  const { ctx } = createContext({
    goalController: {
      setGoal: async (condition) => {
        conditionSeen = condition;
        return { condition, status: "active" };
      },
      buildInitialPrompt: (condition) => `目标条件: ${condition}`,
    },
  });
  const handled = await handleSlashCommand("/目标 所有 auth 测试通过", ctx);
  assert.equal(handled, true);
  assert.equal(conditionSeen, "所有 auth 测试通过");
});

test("slash loop daemon delegates to daemon session api", async () => {
  let call = null;
  const { ctx, lines } = createContext({
    daemonSessionApi: {
      createLoopTask: async (sessionId, payload) => {
        call = { sessionId, payload };
        return {
          id: "tsk_daemon_1",
          prompt: payload.prompt,
          intervalMs: payload.intervalMs,
          mode: payload.mode,
          runner: "daemon",
          status: "active",
          pending: false,
          nextRunAt: Date.now() + payload.intervalMs,
        };
      },
    },
    agentLoop: {
      getSessionId: () => "session-test",
      checkpointSession: async () => "ok",
    },
  });
  const handled = await handleSlashCommand("/loop daemon 5m 检查构建结果", ctx);
  assert.equal(handled, true);
  assert.equal(call.sessionId, "session-test");
  assert.equal(call.payload.runner, "daemon");
  assert.match(lines.join("\n"), /daemon/i);
});

test("slash loop daemon denies on non-git workspace when isolation policy=deny", async () => {
  await withTempDir(async (workspaceDir) => {
    let call = null;
    await withEnv(
      {
        QINGLING_AGENTS_ISOLATION_MODE: "worktree",
        QINGLING_AGENTS_ISOLATION_REQUIRE_GIT: "true",
        QINGLING_AGENTS_ISOLATION_NON_GIT_POLICY: "deny",
      },
      async () => {
        const { ctx, errors } = createContext({
          daemonSessionApi: {
            createLoopTask: async (sessionId, payload) => {
              call = { sessionId, payload };
              return {
                id: "tsk_daemon_2",
                prompt: payload.prompt,
                intervalMs: payload.intervalMs,
                mode: payload.mode,
                runner: "daemon",
                status: "active",
                pending: false,
                nextRunAt: Date.now() + payload.intervalMs,
              };
            },
          },
          workspaceDir,
          agentLoop: {
            getSessionId: () => "session-test",
            checkpointSession: async () => "ok",
          },
        });
        const handled = await handleSlashCommand("/loop daemon 5m 检查构建结果", ctx);
        assert.equal(handled, true);
        assert.equal(call, null);
        assert.match(errors.join("\n"), /non-git|不允许|block|deny/i);
      }
    );
  });
});

test("slash loop daemon warns on non-git workspace when isolation policy=warn", async () => {
  await withTempDir(async (workspaceDir) => {
    let call = null;
    await withEnv(
      {
        QINGLING_AGENTS_ISOLATION_MODE: "worktree",
        QINGLING_AGENTS_ISOLATION_REQUIRE_GIT: "true",
        QINGLING_AGENTS_ISOLATION_NON_GIT_POLICY: "warn",
      },
      async () => {
        const { ctx, lines } = createContext({
          daemonSessionApi: {
            createLoopTask: async (sessionId, payload) => {
              call = { sessionId, payload };
              return {
                id: "tsk_daemon_3",
                prompt: payload.prompt,
                intervalMs: payload.intervalMs,
                mode: payload.mode,
                runner: "daemon",
                status: "active",
                pending: false,
                nextRunAt: Date.now() + payload.intervalMs,
              };
            },
          },
          workspaceDir,
          agentLoop: {
            getSessionId: () => "session-test",
            checkpointSession: async () => "ok",
          },
        });
        const handled = await handleSlashCommand("/loop daemon 5m 检查构建结果", ctx);
        assert.equal(handled, true);
        assert.equal(call.sessionId, "session-test");
        assert.match(lines.join("\n"), /non-git|降级|warn/i);
      }
    );
  });
});

test("slash goal daemon delegates to daemon session api without immediate prompt", async () => {
  let call = null;
  let immediatePrompt = null;
  const { ctx, lines } = createContext({
    daemonSessionApi: {
      setGoal: async (sessionId, condition) => {
        call = { sessionId, condition };
        return { condition, status: "active", runner: "daemon", pending: true };
      },
    },
    setImmediatePrompt: (prompt) => {
      immediatePrompt = prompt;
    },
    agentLoop: {
      getSessionId: () => "session-test",
      checkpointSession: async () => "ok",
      getSessionStats: () => ({ sessionId: "session-test", turnCount: 3, tokens: 1234, compactions: 0 }),
    },
  });
  const handled = await handleSlashCommand("/goal daemon 所有 auth 测试通过", ctx);
  assert.equal(handled, true);
  assert.equal(call.sessionId, "session-test");
  assert.equal(call.condition, "所有 auth 测试通过");
  assert.equal(immediatePrompt, null);
  assert.match(lines.join("\n"), /daemon/i);
});

test("slash goal daemon without args queries daemon goal status", async () => {
  let statusCalls = 0;
  const { ctx, lines } = createContext({
    daemonSessionApi: {
      getGoal: async () => {
        statusCalls += 1;
        return { status: "active", condition: "所有测试通过", runner: "daemon", pending: true };
      },
    },
  });
  const handled = await handleSlashCommand("/goal daemon", ctx);
  assert.equal(handled, true);
  assert.equal(statusCalls, 1);
  assert.match(lines.join("\n"), /active/i);
  assert.match(lines.join("\n"), /daemon/i);
});

test("slash goal daemon clear delegates to daemon session api", async () => {
  let clearCalls = 0;
  const { ctx, lines } = createContext({
    daemonSessionApi: {
      clearGoal: async () => {
        clearCalls += 1;
        return { status: "cleared", condition: "所有测试通过", runner: "daemon", pending: false };
      },
    },
  });
  const handled = await handleSlashCommand("/goal daemon clear", ctx);
  assert.equal(handled, true);
  assert.equal(clearCalls, 1);
  assert.match(lines.join("\n"), /清除|cleared|停止/i);
});

test("slash tasks daemon list delegates to daemon session api", async () => {
  let listCalls = 0;
  const { ctx, lines } = createContext({
    daemonSessionApi: {
      listLoopTasks: async () => {
        listCalls += 1;
        return [
          {
            id: "tsk_daemon_1",
            status: "active",
            mode: "fixed",
            intervalMs: 60000,
            runner: "daemon",
            prompt: "检查构建结果",
            pending: false,
            nextRunAt: Date.now() + 60000,
          },
        ];
      },
    },
  });
  const handled = await handleSlashCommand("/tasks daemon", ctx);
  assert.equal(handled, true);
  assert.equal(listCalls, 1);
  assert.match(lines.join("\n"), /tsk_daemon_1/);
  assert.match(lines.join("\n"), /daemon/i);
});

test("slash tasks daemon cancel delegates to daemon session api", async () => {
  let canceledId = null;
  const { ctx, lines } = createContext({
    daemonSessionApi: {
      cancelLoopTask: async (_sessionId, taskId) => {
        canceledId = taskId;
        return { id: taskId, status: "canceled", runner: "daemon" };
      },
    },
  });
  const handled = await handleSlashCommand("/tasks daemon cancel tsk_daemon_9", ctx);
  assert.equal(handled, true);
  assert.equal(canceledId, "tsk_daemon_9");
  assert.match(lines.join("\n"), /tsk_daemon_9/);
});

test("slash tasks daemon clear delegates to daemon session api", async () => {
  let clearCalls = 0;
  const { ctx, lines } = createContext({
    daemonSessionApi: {
      clearLoopTasks: async () => {
        clearCalls += 1;
        return 2;
      },
    },
  });
  const handled = await handleSlashCommand("/tasks daemon clear", ctx);
  assert.equal(handled, true);
  assert.equal(clearCalls, 1);
  assert.match(lines.join("\n"), /2/);
});

test("slash tasks chinese alias delegates to scheduler list", async () => {
  let listCalls = 0;
  const { ctx } = createContext({
    scheduler: {
      listTasks: async () => {
        listCalls += 1;
        return [];
      },
    },
  });
  const handled = await handleSlashCommand("/任务", ctx);
  assert.equal(handled, true);
  assert.equal(listCalls, 1);
});

test("slash permissions shows current mode", async () => {
  const { ctx, lines } = createContext({
    agentLoop: {
      getPermissionMode: () => "ask",
    },
  });
  const handled = await handleSlashCommand("/permissions", ctx);
  assert.equal(handled, true);
  const joined = lines.join("\n");
  assert.match(joined, /ask/i);
  assert.match(joined, /确认/);
});

test("slash permissions explain reads local rules without leaking secrets", async () => {
  await withEnv(
    {
      QINGLING_GUARD_PERMISSIONS_DEFAULT: "allow",
      QINGLING_GUARD_PERMISSIONS_RULES: JSON.stringify([
        { tool_pattern: "bash", decision: "ask", reason: "shell requires review" },
      ]),
      QINGLING_LLM_API_KEY: "sk-permissions-explain-secret",
    },
    async () => {
      const { ctx, lines } = createContext();
      const handled = await handleSlashCommand("/permissions explain bash", ctx);

      assert.equal(handled, true);
      const joined = lines.join("\n");
      assert.match(joined, /权限解释/);
      assert.match(joined, /Tool\s*: bash/);
      assert.match(joined, /Decision\s*: ask\(确认\)/);
      assert.match(joined, /Matched\s*: bash/);
      assert.match(joined, /shell requires review/);
      assert.doesNotMatch(joined, /sk-permissions-explain-secret/);
    }
  );
});

test("slash permissions chinese explain alias works", async () => {
  await withEnv(
    {
      QINGLING_GUARD_PERMISSIONS_DEFAULT: "deny",
      QINGLING_GUARD_PERMISSIONS_RULES: JSON.stringify([
        { tool_pattern: "read", decision: "allow" },
      ]),
    },
    async () => {
      const { ctx, lines } = createContext();
      const handled = await handleSlashCommand("/权限 解释 read", ctx);

      assert.equal(handled, true);
      const joined = lines.join("\n");
      assert.match(joined, /Tool\s*: read/);
      assert.match(joined, /Decision\s*: allow\(自动\)/);
      assert.match(joined, /Matched\s*: read/);
    }
  );
});

test("slash permissions set mode delegates to agent loop", async () => {
  let seenMode = null;
  const { ctx, lines } = createContext({
    agentLoop: {
      setPermissionMode: (mode) => {
        seenMode = mode;
      },
      getPermissionMode: () => "deny",
    },
  });
  const handled = await handleSlashCommand("/permissions deny", ctx);
  assert.equal(handled, true);
  assert.equal(seenMode, "deny");
  const joined = lines.join("\n");
  assert.match(joined, /deny/i);
  assert.match(joined, /拒绝/);
});

test("slash permissions rejects invalid mode", async () => {
  const { ctx, errors } = createContext();
  const handled = await handleSlashCommand("/permissions invalid", ctx);
  assert.equal(handled, true);
  assert.match(errors.join("\n"), /allow|deny|ask/i);
});

test("slash sessions lists saved session summaries", async () => {
  const { ctx, lines } = createContext({
    listSavedSessions: async () => [
      {
        name: "session-123",
        sessionId: "session-123",
        updatedAt: "2026-05-16T10:00:00.000Z",
        turnCount: 4,
        messageCount: 8,
      },
    ],
  });
  const handled = await handleSlashCommand("/sessions", ctx);
  assert.equal(handled, true);
  assert.match(lines.join("\n"), /session-123/);
  assert.match(lines.join("\n"), /4/);
});

test("slash resume latest delegates to session switcher", async () => {
  let targetSeen = "not-called";
  const { ctx, lines } = createContext({
    switchSession: async (target) => {
      targetSeen = target;
      return {
        name: "session-latest",
        sessionId: "session-latest",
        turnCount: 5,
        messageCount: 10,
        activeTaskCount: 1,
        activeGoalStatus: "active",
      };
    },
  });
  const handled = await handleSlashCommand("/resume latest", ctx);
  assert.equal(handled, true);
  assert.equal(targetSeen, undefined);
  assert.match(lines.join("\n"), /session-latest/);
});

test("slash resume target delegates to session switcher", async () => {
  let targetSeen = null;
  const { ctx, lines } = createContext({
    switchSession: async (target) => {
      targetSeen = target;
      return {
        name: "session-456",
        sessionId: "session-456",
        turnCount: 2,
        messageCount: 4,
        activeTaskCount: 0,
        activeGoalStatus: null,
      };
    },
  });
  const handled = await handleSlashCommand("/resume session-456", ctx);
  assert.equal(handled, true);
  assert.equal(targetSeen, "session-456");
  assert.match(lines.join("\n"), /session-456/);
});
