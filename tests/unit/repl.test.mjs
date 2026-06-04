import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Repl } from "../../dist/repl.js";

function createAgent(overrides = {}) {
  const calls = [];
  return {
    calls,
    addUserMessage: (input) => {
      calls.push(["addUserMessage", input]);
    },
    run: async () => {
      calls.push(["run"]);
      return "model response";
    },
    checkpointSession: async () => {
      calls.push(["checkpointSession"]);
    },
    shutdown: async () => {
      calls.push(["shutdown"]);
    },
    reset: () => {
      calls.push(["reset"]);
    },
    saveSession: async (name) => {
      calls.push(["saveSession", name]);
      return "saved-session.json";
    },
    listSessions: async () => {
      calls.push(["listSessions"]);
      return [];
    },
    restoreSession: async (name) => {
      calls.push(["restoreSession", name]);
      return null;
    },
    restoreLatestSession: async () => {
      calls.push(["restoreLatestSession"]);
      return null;
    },
    ...overrides,
  };
}

async function closeRepl(repl) {
  await repl.resetLocalSessionControllers?.();
  repl.rl?.close?.();
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "qingling-repl-local-control-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function seedLoopTask(stateDir, sessionId, prompt, nextRunAt = Date.now() + 250) {
  const tasksDir = join(stateDir, "session-tasks");
  await mkdir(tasksDir, { recursive: true });
  await writeFile(join(tasksDir, `${sessionId}.json`), JSON.stringify([
    {
      id: `tsk_loop_${sessionId}`,
      kind: "loop",
      prompt,
      intervalMs: 60_000,
      mode: "fixed",
      runner: "session",
      status: "active",
      pending: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nextRunAt,
    },
  ], null, 2), "utf-8");
}

async function seedGoal(stateDir, sessionId, condition, status = "active") {
  const goalsDir = join(stateDir, "session-goals");
  const now = Date.now();
  await mkdir(goalsDir, { recursive: true });
  await writeFile(join(goalsDir, `${sessionId}.json`), JSON.stringify({
    condition,
    status,
    runner: "session",
    pending: false,
    createdAt: now,
    updatedAt: now,
    baselineTurns: 0,
    baselineTokens: 0,
    evaluatedTurns: 0,
    lastReason: "seeded",
    lastDecision: null,
  }, null, 2), "utf-8");
}

function createLocalAgent(stateDir, overrides = {}) {
  return createAgent({
    getRuntimeRootDir: () => stateDir,
    getSessionId: () => "session-repl",
    getWorkspaceDir: () => stateDir,
    getSessionStats: () => ({ sessionId: "session-repl", turnCount: 0, tokens: 0, compactions: 0 }),
    getMessagesSnapshot: () => [],
    ...overrides,
  });
}

function createLocalGoalAgent(stateDir, overrides = {}) {
  const messages = [];
  let turnCount = 0;
  const agent = createLocalAgent(stateDir, {
    addUserMessage: (input) => {
      agent.calls.push(["addUserMessage", input]);
      messages.push({ role: "user", content: input });
    },
    run: async () => {
      agent.calls.push(["run"]);
      turnCount += 1;
      const response = `model response ${turnCount}`;
      messages.push({ role: "assistant", content: response });
      return response;
    },
    getSessionStats: () => ({ sessionId: "session-repl", turnCount, tokens: turnCount * 10, compactions: 0 }),
    getMessagesSnapshot: () => messages.map((message) => ({ ...message })),
    ...overrides,
  });
  return agent;
}

async function withGoalEvaluator(results, fn) {
  const originalFetch = globalThis.fetch;
  const originalProvider = process.env.QINGLING_GOAL_EVALUATOR_PROVIDER;
  const originalEndpoint = process.env.QINGLING_GOAL_EVALUATOR_ENDPOINT;
  const queue = [...results];
  const fetchCalls = [];

  process.env.QINGLING_GOAL_EVALUATOR_PROVIDER = "local";
  process.env.QINGLING_GOAL_EVALUATOR_ENDPOINT = "http://goal-evaluator.local/v1";
  globalThis.fetch = async (_url, init) => {
    fetchCalls.push(init);
    const result = queue.shift() ?? results.at(-1) ?? { done: true, reason: "done" };
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(result),
            },
          },
        ],
      }),
    };
  };

  try {
    return await fn(fetchCalls);
  } finally {
    if (originalFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
    if (originalProvider === undefined) {
      delete process.env.QINGLING_GOAL_EVALUATOR_PROVIDER;
    } else {
      process.env.QINGLING_GOAL_EVALUATOR_PROVIDER = originalProvider;
    }
    if (originalEndpoint === undefined) {
      delete process.env.QINGLING_GOAL_EVALUATOR_ENDPOINT;
    } else {
      process.env.QINGLING_GOAL_EVALUATOR_ENDPOINT = originalEndpoint;
    }
  }
}

async function waitFor(predicate, timeoutMs = 2500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await sleep(25);
  }
  assert.fail("condition was not met before timeout");
}

async function captureConsole(fn) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (line = "") => {
    logs.push(String(line));
  };
  console.error = (line = "") => {
    errors.push(String(line));
  };
  try {
    const result = await fn();
    return { result, logs, errors };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("repl slash help is handled locally without model run", async () => {
  const agent = createAgent();
  const repl = new Repl(agent);
  try {
    const { result, logs, errors } = await captureConsole(() => repl.handleInputLine("/help"));

    assert.equal(result, "continue");
    assert.deepEqual(agent.calls, []);
    assert.equal(errors.length, 0);
    const joined = logs.join("\n");
    assert.match(joined, /Slash Commands/);
    assert.match(joined, /\/exports/);
  } finally {
    await closeRepl(repl);
  }
});

test("repl normal prompt still runs the model path and checkpoints", async () => {
  const agent = createAgent();
  const repl = new Repl(agent);
  try {
    const { result, logs } = await captureConsole(() => repl.handleInputLine("fix bug"));

    assert.equal(result, "continue");
    assert.deepEqual(agent.calls, [
      ["addUserMessage", "fix bug"],
      ["run"],
      ["checkpointSession"],
    ]);
    assert.match(logs.join("\n"), /model response/);
  } finally {
    await closeRepl(repl);
  }
});

test("repl keeps legacy sessions command local", async () => {
  const agent = createAgent({
    listSessions: async () => {
      agent.calls.push(["listSessions"]);
      return ["alpha", "beta"];
    },
  });
  const repl = new Repl(agent);
  try {
    const { result, logs } = await captureConsole(() => repl.handleInputLine("!sessions"));

    assert.equal(result, "continue");
    assert.deepEqual(agent.calls, [["listSessions"]]);
    const joined = logs.join("\n");
    assert.match(joined, /已保存的会话/);
    assert.match(joined, /alpha/);
    assert.match(joined, /beta/);
  } finally {
    await closeRepl(repl);
  }
});

test("repl legacy sessions uses detailed local session metadata when available", async () => {
  const agent = createAgent({
    listSessionsDetailed: async () => {
      agent.calls.push(["listSessionsDetailed"]);
      return [
        {
          name: "alpha",
          sessionId: "sess_alpha",
          updatedAt: "2026-06-02T10:00:00.000Z",
          turnCount: 3,
          messageCount: 7,
        },
      ];
    },
  });
  const repl = new Repl(agent);
  try {
    const { result, logs } = await captureConsole(() => repl.handleInputLine("!sessions"));

    assert.equal(result, "continue");
    assert.deepEqual(agent.calls, [["listSessionsDetailed"]]);
    const joined = logs.join("\n");
    assert.match(joined, /已保存的会话/);
    assert.match(joined, /alpha/);
    assert.match(joined, /sess_alpha/);
    assert.match(joined, /turns=3/);
    assert.match(joined, /messages=7/);
  } finally {
    await closeRepl(repl);
  }
});

test("repl bare legacy load lists detailed local session metadata when available", async () => {
  const agent = createAgent({
    listSessionsDetailed: async () => {
      agent.calls.push(["listSessionsDetailed"]);
      return [
        {
          name: "latest",
          sessionId: "sess_latest",
          updatedAt: "2026-06-02T11:00:00.000Z",
          turnCount: 5,
          messageCount: 12,
        },
      ];
    },
  });
  const repl = new Repl(agent);
  try {
    const { result, logs } = await captureConsole(() => repl.handleInputLine("!load"));

    assert.equal(result, "continue");
    assert.deepEqual(agent.calls, [["listSessionsDetailed"]]);
    const joined = logs.join("\n");
    assert.match(joined, /已保存的会话/);
    assert.match(joined, /latest/);
    assert.match(joined, /sess_latest/);
    assert.match(joined, /turns=5/);
    assert.match(joined, /messages=12/);
  } finally {
    await closeRepl(repl);
  }
});

test("repl legacy load numeric target restores matching detailed local session", async () => {
  const restored = {
    name: "beta",
    sessionId: "sess_beta",
    turnCount: 4,
    messageCount: 9,
    updatedAt: "2026-06-03T10:00:00.000Z",
  };
  const agent = createAgent({
    listSessionsDetailed: async () => {
      agent.calls.push(["listSessionsDetailed"]);
      return [
        {
          name: "alpha",
          sessionId: "sess_alpha",
          updatedAt: "2026-06-03T09:00:00.000Z",
          turnCount: 2,
          messageCount: 5,
        },
        restored,
      ];
    },
    restoreSession: async (name) => {
      agent.calls.push(["restoreSession", name]);
      return name === "beta" ? restored : null;
    },
  });
  const repl = new Repl(agent);
  try {
    const { result, logs } = await captureConsole(() => repl.handleInputLine("!load 2"));

    assert.equal(result, "continue");
    assert.deepEqual(agent.calls, [
      ["listSessionsDetailed"],
      ["restoreSession", "beta"],
      ["checkpointSession"],
    ]);
    const joined = logs.join("\n");
    assert.match(joined, /会话已恢复/);
    assert.match(joined, /beta/);
    assert.match(joined, /sess_beta/);
  } finally {
    await closeRepl(repl);
  }
});

test("repl legacy load numeric target falls back to legacy local session names", async () => {
  const restored = {
    name: "beta",
    sessionId: "sess_beta",
    turnCount: 4,
    messageCount: 9,
    updatedAt: "2026-06-03T10:00:00.000Z",
  };
  const agent = createAgent({
    listSessions: async () => {
      agent.calls.push(["listSessions"]);
      return ["alpha", "beta"];
    },
    restoreSession: async (name) => {
      agent.calls.push(["restoreSession", name]);
      return name === "beta" ? restored : null;
    },
  });
  const repl = new Repl(agent);
  try {
    const { result, logs } = await captureConsole(() => repl.handleInputLine("!load 2"));

    assert.equal(result, "continue");
    assert.deepEqual(agent.calls, [
      ["listSessions"],
      ["restoreSession", "beta"],
      ["checkpointSession"],
    ]);
    const joined = logs.join("\n");
    assert.match(joined, /会话已恢复/);
    assert.match(joined, /beta/);
    assert.match(joined, /sess_beta/);
  } finally {
    await closeRepl(repl);
  }
});

test("repl slash sessions uses detailed local session metadata without model run", async () => {
  const agent = createAgent({
    listSessionsDetailed: async () => {
      agent.calls.push(["listSessionsDetailed"]);
      return [
        {
          name: "alpha",
          sessionId: "sess_alpha",
          updatedAt: "2026-06-02T10:00:00.000Z",
          turnCount: 2,
          messageCount: 4,
        },
      ];
    },
  });
  const repl = new Repl(agent);
  try {
    const { result, logs, errors } = await captureConsole(() => repl.handleInputLine("/sessions"));

    assert.equal(result, "continue");
    assert.equal(errors.length, 0);
    assert.deepEqual(agent.calls, [["listSessionsDetailed"]]);
    const joined = logs.join("\n");
    assert.match(joined, /已保存会话/);
    assert.match(joined, /alpha/);
    assert.match(joined, /sess_alpha/);
  } finally {
    await closeRepl(repl);
  }
});

test("repl slash sessions falls back to legacy local session names when detailed metadata is unavailable", async () => {
  const agent = createAgent({
    listSessions: async () => {
      agent.calls.push(["listSessions"]);
      return ["legacy-alpha"];
    },
  });
  const repl = new Repl(agent);
  try {
    const { result, logs, errors } = await captureConsole(() => repl.handleInputLine("/sessions"));

    assert.equal(result, "continue");
    assert.equal(errors.length, 0);
    assert.deepEqual(agent.calls, [["listSessions"]]);
    const joined = logs.join("\n");
    assert.match(joined, /已保存会话/);
    assert.match(joined, /legacy-alpha/);
  } finally {
    await closeRepl(repl);
  }
});

test("repl slash resume latest checkpoints restored session", async () => {
  const restored = {
    name: "latest",
    sessionId: "sess_latest",
    turnCount: 3,
    messageCount: 7,
    updatedAt: "2026-06-02T10:00:00.000Z",
  };
  const agent = createAgent({
    restoreLatestSession: async () => {
      agent.calls.push(["restoreLatestSession"]);
      return restored;
    },
  });
  const repl = new Repl(agent);
  try {
    const { result, logs, errors } = await captureConsole(() => repl.handleInputLine("/resume latest"));

    assert.equal(result, "continue");
    assert.equal(errors.length, 0);
    assert.deepEqual(agent.calls, [
      ["restoreLatestSession"],
      ["checkpointSession"],
    ]);
    const joined = logs.join("\n");
    assert.match(joined, /会话已恢复/);
    assert.match(joined, /sess_latest/);
  } finally {
    await closeRepl(repl);
  }
});

test("repl slash resume target checkpoints restored session", async () => {
  const restored = {
    name: "target",
    sessionId: "sess_target",
    turnCount: 5,
    messageCount: 11,
    updatedAt: "2026-06-02T10:00:00.000Z",
  };
  const agent = createAgent({
    restoreSession: async (name) => {
      agent.calls.push(["restoreSession", name]);
      return restored;
    },
  });
  const repl = new Repl(agent);
  try {
    const { result, logs, errors } = await captureConsole(() => repl.handleInputLine("/resume session-1"));

    assert.equal(result, "continue");
    assert.equal(errors.length, 0);
    assert.deepEqual(agent.calls, [
      ["restoreSession", "session-1"],
      ["checkpointSession"],
    ]);
    const joined = logs.join("\n");
    assert.match(joined, /会话已恢复/);
    assert.match(joined, /sess_target/);
  } finally {
    await closeRepl(repl);
  }
});

test("repl slash loop creates local session task without model run", async () => {
  await withTempDir(async (stateDir) => {
    const agent = createLocalAgent(stateDir);
    const repl = new Repl(agent);
    try {
      const { result, logs, errors } = await captureConsole(() => repl.handleInputLine("/loop 1m 检查构建"));

      assert.equal(result, "continue");
      assert.equal(errors.length, 0);
      assert.deepEqual(agent.calls, []);
      assert.match(logs.join("\n"), /已创建 Loop 任务/);

      const raw = await readFile(join(stateDir, "session-tasks", "session-repl.json"), "utf-8");
      const tasks = JSON.parse(raw);
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].prompt, "检查构建");
      assert.equal(tasks[0].runner, "session");
    } finally {
      await closeRepl(repl);
    }
  });
});

test("repl slash tasks lists local session task without model run", async () => {
  await withTempDir(async (stateDir) => {
    const agent = createLocalAgent(stateDir);
    const repl = new Repl(agent);
    try {
      await captureConsole(() => repl.handleInputLine("/loop 1m 检查构建"));
      agent.calls.length = 0;

      const { result, logs, errors } = await captureConsole(() => repl.handleInputLine("/tasks"));

      assert.equal(result, "continue");
      assert.equal(errors.length, 0);
      assert.deepEqual(agent.calls, []);
      const joined = logs.join("\n");
      assert.match(joined, /当前 Session 任务/);
      assert.match(joined, /检查构建/);
    } finally {
      await closeRepl(repl);
    }
  });
});

test("repl slash goal persists local goal and runs generated initial prompt", async () => {
  await withTempDir(async (stateDir) => {
    await withGoalEvaluator([{ done: true, reason: "首轮已满足" }], async () => {
      const agent = createLocalGoalAgent(stateDir);
      const repl = new Repl(agent);
      try {
        const { result, logs, errors } = await captureConsole(() => repl.handleInputLine("/goal 所有测试通过"));

        assert.equal(result, "continue");
        assert.equal(errors.length, 0);
        assert.equal(agent.calls[0][0], "addUserMessage");
        assert.match(agent.calls[0][1], /当前激活目标条件：所有测试通过/);
        assert.doesNotMatch(agent.calls[0][1], /^\/goal/);
        assert.deepEqual(agent.calls.slice(1), [
          ["run"],
          ["checkpointSession"],
        ]);
        assert.match(logs.join("\n"), /\/goal active/);

        const raw = await readFile(join(stateDir, "session-goals", "session-repl.json"), "utf-8");
        const goal = JSON.parse(raw);
        assert.equal(goal.condition, "所有测试通过");
        assert.equal(goal.status, "achieved");
        assert.equal(goal.runner, "session");
      } finally {
        await closeRepl(repl);
      }
    });
  });
});

test("repl slash goal auto-continues until evaluator reports achieved", async () => {
  await withTempDir(async (stateDir) => {
    await withGoalEvaluator([
      { done: false, reason: "还缺验证" },
      { done: true, reason: "证据已满足" },
    ], async (fetchCalls) => {
      const agent = createLocalGoalAgent(stateDir);
      const repl = new Repl(agent);
      try {
        const { result, logs, errors } = await captureConsole(() => repl.handleInputLine("/goal 所有测试通过"));

        assert.equal(result, "continue");
        assert.equal(errors.length, 0);
        assert.equal(fetchCalls.length, 2);

        const prompts = agent.calls
          .filter((call) => call[0] === "addUserMessage")
          .map((call) => call[1]);
        assert.equal(prompts.length, 2);
        assert.match(prompts[0], /当前激活目标条件：所有测试通过/);
        assert.match(prompts[1], /上一轮 goal 评估：还缺验证/);

        assert.equal(agent.calls.filter((call) => call[0] === "run").length, 2);
        assert.equal(agent.calls.filter((call) => call[0] === "checkpointSession").length, 2);
        const joined = logs.join("\n");
        assert.match(joined, /goal 未达成: 还缺验证/);
        assert.match(joined, /goal 已达成: 证据已满足/);
      } finally {
        await closeRepl(repl);
      }
    });
  });
});

test("repl slash loop runs due task from local scheduler timer", async () => {
  await withTempDir(async (stateDir) => {
    const agent = createLocalAgent(stateDir);
    const repl = new Repl(agent);
    try {
      const { result, errors } = await captureConsole(async () => {
        const handled = await repl.handleInputLine("/loop 1s 自动检查");
        await waitFor(() => agent.calls.some((call) => call[0] === "run"));
        await waitFor(async () => {
          const raw = await readFile(join(stateDir, "session-tasks", "session-repl.json"), "utf-8");
          const tasks = JSON.parse(raw);
          return Boolean(tasks[0]?.lastRunAt);
        });
        return handled;
      });

      assert.equal(result, "continue");
      assert.equal(errors.length, 0);
      assert.deepEqual(agent.calls.slice(0, 3), [
        ["addUserMessage", "自动检查"],
        ["run"],
        ["checkpointSession"],
      ]);
    } finally {
      await closeRepl(repl);
    }
  });
});

test("repl legacy reset cancels local loop tasks without model run", async () => {
  await withTempDir(async (stateDir) => {
    const agent = createLocalAgent(stateDir);
    const repl = new Repl(agent);
    try {
      await captureConsole(() => repl.handleInputLine("/loop 1m 自动检查"));
      agent.calls.length = 0;

      const { result, logs, errors } = await captureConsole(() => repl.handleInputLine("!reset"));

      assert.equal(result, "continue");
      assert.equal(errors.length, 0);
      assert.deepEqual(agent.calls, [
        ["reset"],
        ["checkpointSession"],
      ]);
      assert.match(logs.join("\n"), /对话已重置/);

      const raw = await readFile(join(stateDir, "session-tasks", "session-repl.json"), "utf-8");
      const tasks = JSON.parse(raw);
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].status, "canceled");
    } finally {
      await closeRepl(repl);
    }
  });
});

test("repl legacy load stops previous session loop timer after restore", async () => {
  await withTempDir(async (stateDir) => {
    let sessionId = "session-old";
    const restored = {
      name: "restored",
      sessionId: "session-new",
      turnCount: 1,
      messageCount: 2,
      updatedAt: "2026-06-02T10:00:00.000Z",
    };
    const agent = createLocalAgent(stateDir, {
      getSessionId: () => sessionId,
      restoreSession: async (name) => {
        agent.calls.push(["restoreSession", name]);
        sessionId = restored.sessionId;
        return restored;
      },
    });
    const repl = new Repl(agent);
    try {
      await captureConsole(() => repl.handleInputLine("/loop 1s 旧任务不应继续"));
      agent.calls.length = 0;

      const { result, logs, errors } = await captureConsole(async () => {
        const handled = await repl.handleInputLine("!load restored");
        await sleep(1200);
        return handled;
      });

      assert.equal(result, "continue");
      assert.equal(errors.length, 0);
      assert.deepEqual(agent.calls, [
        ["restoreSession", "restored"],
        ["checkpointSession"],
      ]);
      const joined = logs.join("\n");
      assert.match(joined, /会话已恢复/);
      assert.match(joined, /session-new/);
    } finally {
      await closeRepl(repl);
    }
  });
});

test("repl slash resume hydrates restored session loop timer", async () => {
  await withTempDir(async (stateDir) => {
    let sessionId = "session-old";
    const restored = {
      name: "restored",
      sessionId: "session-new",
      turnCount: 1,
      messageCount: 2,
      updatedAt: "2026-06-02T10:00:00.000Z",
    };
    await seedLoopTask(stateDir, restored.sessionId, "新任务应接续");
    const agent = createLocalAgent(stateDir, {
      getSessionId: () => sessionId,
      restoreSession: async (name) => {
        agent.calls.push(["restoreSession", name]);
        sessionId = restored.sessionId;
        return restored;
      },
    });
    const repl = new Repl(agent);
    try {
      const { result, logs, errors } = await captureConsole(async () => {
        const handled = await repl.handleInputLine("/resume session-new");
        await waitFor(() => agent.calls.some((call) => call[0] === "run"));
        await waitFor(async () => {
          const raw = await readFile(join(stateDir, "session-tasks", `${restored.sessionId}.json`), "utf-8");
          const tasks = JSON.parse(raw);
          return Boolean(tasks[0]?.lastRunAt);
        });
        return handled;
      });

      assert.equal(result, "continue");
      assert.equal(errors.length, 0);
      assert.deepEqual(agent.calls.slice(0, 5), [
        ["restoreSession", "session-new"],
        ["checkpointSession"],
        ["addUserMessage", "新任务应接续"],
        ["run"],
        ["checkpointSession"],
      ]);
      assert.match(logs.join("\n"), /会话已恢复/);
    } finally {
      await closeRepl(repl);
    }
  });
});

test("repl slash resume reports restored local loop and goal status", async () => {
  await withTempDir(async (stateDir) => {
    let sessionId = "session-old";
    const restored = {
      name: "restored",
      sessionId: "session-new",
      turnCount: 1,
      messageCount: 2,
      updatedAt: "2026-06-02T10:00:00.000Z",
    };
    await seedLoopTask(stateDir, restored.sessionId, "未来任务不应立即运行", Date.now() + 60_000);
    await seedGoal(stateDir, restored.sessionId, "所有测试通过");
    const agent = createLocalAgent(stateDir, {
      getSessionId: () => sessionId,
      restoreSession: async (name) => {
        agent.calls.push(["restoreSession", name]);
        sessionId = restored.sessionId;
        return restored;
      },
    });
    const repl = new Repl(agent);
    try {
      const { result, logs, errors } = await captureConsole(() => repl.handleInputLine("/resume session-new"));

      assert.equal(result, "continue");
      assert.equal(errors.length, 0);
      assert.deepEqual(agent.calls, [
        ["restoreSession", "session-new"],
        ["checkpointSession"],
      ]);
      const joined = logs.join("\n");
      assert.match(joined, /会话已恢复/);
      assert.match(joined, /Loop Tasks\s*:\s*1/);
      assert.match(joined, /Goal\s*:\s*active/);
    } finally {
      await closeRepl(repl);
    }
  });
});

test("repl legacy load hydrates restored session loop timer", async () => {
  await withTempDir(async (stateDir) => {
    let sessionId = "session-old";
    const restored = {
      name: "restored",
      sessionId: "session-new",
      turnCount: 1,
      messageCount: 2,
      updatedAt: "2026-06-02T10:00:00.000Z",
    };
    await seedLoopTask(stateDir, restored.sessionId, "旧入口新任务应接续");
    const agent = createLocalAgent(stateDir, {
      getSessionId: () => sessionId,
      restoreSession: async (name) => {
        agent.calls.push(["restoreSession", name]);
        sessionId = restored.sessionId;
        return restored;
      },
    });
    const repl = new Repl(agent);
    try {
      const { result, logs, errors } = await captureConsole(async () => {
        const handled = await repl.handleInputLine("!load restored");
        await waitFor(() => agent.calls.some((call) => call[0] === "run"));
        await waitFor(async () => {
          const raw = await readFile(join(stateDir, "session-tasks", `${restored.sessionId}.json`), "utf-8");
          const tasks = JSON.parse(raw);
          return Boolean(tasks[0]?.lastRunAt);
        });
        return handled;
      });

      assert.equal(result, "continue");
      assert.equal(errors.length, 0);
      assert.deepEqual(agent.calls.slice(0, 5), [
        ["restoreSession", "restored"],
        ["checkpointSession"],
        ["addUserMessage", "旧入口新任务应接续"],
        ["run"],
        ["checkpointSession"],
      ]);
      assert.match(logs.join("\n"), /会话已恢复/);
    } finally {
      await closeRepl(repl);
    }
  });
});

test("repl legacy load reports restored local loop and goal status", async () => {
  await withTempDir(async (stateDir) => {
    let sessionId = "session-old";
    const restored = {
      name: "restored",
      sessionId: "session-new",
      turnCount: 1,
      messageCount: 2,
      updatedAt: "2026-06-02T10:00:00.000Z",
    };
    await seedLoopTask(stateDir, restored.sessionId, "旧入口未来任务不应立即运行", Date.now() + 60_000);
    await seedGoal(stateDir, restored.sessionId, "所有测试通过");
    const agent = createLocalAgent(stateDir, {
      getSessionId: () => sessionId,
      restoreSession: async (name) => {
        agent.calls.push(["restoreSession", name]);
        sessionId = restored.sessionId;
        return restored;
      },
    });
    const repl = new Repl(agent);
    try {
      const { result, logs, errors } = await captureConsole(() => repl.handleInputLine("!load restored"));

      assert.equal(result, "continue");
      assert.equal(errors.length, 0);
      assert.deepEqual(agent.calls, [
        ["restoreSession", "restored"],
        ["checkpointSession"],
      ]);
      const joined = logs.join("\n");
      assert.match(joined, /会话已恢复/);
      assert.match(joined, /Loop Tasks\s*:\s*1/);
      assert.match(joined, /Goal\s*:\s*active/);
    } finally {
      await closeRepl(repl);
    }
  });
});

test("repl startup resume reports restored local loop and goal status", async () => {
  await withTempDir(async (stateDir) => {
    let sessionId = "session-before-start";
    const restored = {
      name: "startup-restored",
      sessionId: "session-startup-resume",
      turnCount: 1,
      messageCount: 2,
      updatedAt: "2026-06-02T10:00:00.000Z",
    };
    await seedLoopTask(stateDir, restored.sessionId, "启动恢复未来任务不应立即运行", Date.now() + 60_000);
    await seedGoal(stateDir, restored.sessionId, "所有测试通过");
    const agent = createLocalAgent(stateDir, {
      getSessionId: () => sessionId,
      restoreSession: async (name) => {
        agent.calls.push(["restoreSession", name]);
        sessionId = restored.sessionId;
        return restored;
      },
    });
    const repl = new Repl(agent, { resumeSession: "session-startup-resume" });
    try {
      const { logs, errors } = await captureConsole(() => repl.start());

      assert.equal(errors.length, 0);
      assert.deepEqual(agent.calls, [
        ["restoreSession", "session-startup-resume"],
        ["checkpointSession"],
      ]);
      const joined = logs.join("\n");
      assert.match(joined, /已恢复会话/);
      assert.match(joined, /Loop Tasks\s*:\s*1/);
      assert.match(joined, /Goal\s*:\s*active/);
    } finally {
      await closeRepl(repl);
    }
  });
});

test("repl startup continue reports restored local loop and goal status", async () => {
  await withTempDir(async (stateDir) => {
    let sessionId = "session-before-start";
    const restored = {
      name: "latest-restored",
      sessionId: "session-startup-latest",
      turnCount: 1,
      messageCount: 2,
      updatedAt: "2026-06-02T10:00:00.000Z",
    };
    await seedLoopTask(stateDir, restored.sessionId, "继续恢复未来任务不应立即运行", Date.now() + 60_000);
    await seedGoal(stateDir, restored.sessionId, "所有测试通过");
    const agent = createLocalAgent(stateDir, {
      getSessionId: () => sessionId,
      restoreLatestSession: async () => {
        agent.calls.push(["restoreLatestSession"]);
        sessionId = restored.sessionId;
        return restored;
      },
    });
    const repl = new Repl(agent, { continueSession: true });
    try {
      const { logs, errors } = await captureConsole(() => repl.start());

      assert.equal(errors.length, 0);
      assert.deepEqual(agent.calls, [
        ["restoreLatestSession"],
        ["checkpointSession"],
      ]);
      const joined = logs.join("\n");
      assert.match(joined, /已恢复会话/);
      assert.match(joined, /Loop Tasks\s*:\s*1/);
      assert.match(joined, /Goal\s*:\s*active/);
    } finally {
      await closeRepl(repl);
    }
  });
});

test("repl startup resume hydrates restored session loop timer", async () => {
  await withTempDir(async (stateDir) => {
    let sessionId = "session-before-start";
    const restored = {
      name: "startup-restored",
      sessionId: "session-startup-resume",
      turnCount: 1,
      messageCount: 2,
      updatedAt: "2026-06-02T10:00:00.000Z",
    };
    await seedLoopTask(stateDir, restored.sessionId, "启动恢复任务应接续");
    const agent = createLocalAgent(stateDir, {
      getSessionId: () => sessionId,
      restoreSession: async (name) => {
        agent.calls.push(["restoreSession", name]);
        sessionId = restored.sessionId;
        return restored;
      },
    });
    const repl = new Repl(agent, { resumeSession: "session-startup-resume" });
    try {
      const { logs, errors } = await captureConsole(async () => {
        await repl.start();
        await waitFor(() => agent.calls.some((call) => call[0] === "run"));
        await waitFor(async () => {
          const raw = await readFile(join(stateDir, "session-tasks", `${restored.sessionId}.json`), "utf-8");
          const tasks = JSON.parse(raw);
          return Boolean(tasks[0]?.lastRunAt);
        });
      });

      assert.equal(errors.length, 0);
      assert.deepEqual(agent.calls.slice(0, 5), [
        ["restoreSession", "session-startup-resume"],
        ["checkpointSession"],
        ["addUserMessage", "启动恢复任务应接续"],
        ["run"],
        ["checkpointSession"],
      ]);
      assert.match(logs.join("\n"), /已恢复会话/);
    } finally {
      await closeRepl(repl);
    }
  });
});

test("repl startup continue hydrates latest session loop timer", async () => {
  await withTempDir(async (stateDir) => {
    let sessionId = "session-before-start";
    const restored = {
      name: "latest-restored",
      sessionId: "session-startup-latest",
      turnCount: 1,
      messageCount: 2,
      updatedAt: "2026-06-02T10:00:00.000Z",
    };
    await seedLoopTask(stateDir, restored.sessionId, "继续恢复任务应接续");
    const agent = createLocalAgent(stateDir, {
      getSessionId: () => sessionId,
      restoreLatestSession: async () => {
        agent.calls.push(["restoreLatestSession"]);
        sessionId = restored.sessionId;
        return restored;
      },
    });
    const repl = new Repl(agent, { continueSession: true });
    try {
      const { logs, errors } = await captureConsole(async () => {
        await repl.start();
        await waitFor(() => agent.calls.some((call) => call[0] === "run"));
        await waitFor(async () => {
          const raw = await readFile(join(stateDir, "session-tasks", `${restored.sessionId}.json`), "utf-8");
          const tasks = JSON.parse(raw);
          return Boolean(tasks[0]?.lastRunAt);
        });
      });

      assert.equal(errors.length, 0);
      assert.deepEqual(agent.calls.slice(0, 5), [
        ["restoreLatestSession"],
        ["checkpointSession"],
        ["addUserMessage", "继续恢复任务应接续"],
        ["run"],
        ["checkpointSession"],
      ]);
      assert.match(logs.join("\n"), /已恢复会话/);
    } finally {
      await closeRepl(repl);
    }
  });
});
