import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StreamingREPL } from "../../dist/tui/streaming-repl.js";

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createAgent(stateDir) {
  return {
    getModel: () => "test-model",
    getToolCount: () => 0,
    getWorkspaceDir: () => stateDir,
    getRuntimeRootDir: () => stateDir,
    getSessionStats: () => ({ sessionId: "session_queue_idle", tokens: 0, turnCount: 0 }),
    getPermissionMode: () => "ask",
    listSessionsDetailed: async () => [],
  };
}

function createUiRecorder() {
  const prompts = [];
  const validations = [];
  const outputs = [];
  const errors = [];
  let statusLine = null;
  return {
    prompts,
    validations,
    outputs,
    errors,
    setStatusLine: (line) => {
      statusLine = line;
    },
    showPrompt: () => {
      prompts.push(statusLine ?? "");
    },
    appendValidation: (_status, text) => {
      validations.push(String(text));
    },
    appendOutput: (text = "") => {
      outputs.push(String(text));
    },
    appendError: (text = "") => {
      errors.push(String(text));
    },
    setStatusLineEnabled: () => {},
  };
}

test("streaming repl restores prompt after queued input settles with idle statusline", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-repl-queue-"));
  try {
    const repl = new StreamingREPL(createAgent(stateDir));
    const ui = createUiRecorder();
    repl.ui = ui;
    repl.scheduler = {
      listTasks: async () => [],
      runDueTasksOnce: async () => {},
    };
    repl.goalController = {
      getGoalStatus: async () => null,
    };
    repl.processPrompt = async () => {};

    await repl.handleUserInput("本地队列状态测试");

    assert.equal(ui.prompts.length, 1);
    assert.doesNotMatch(ui.prompts[0], /queue=/);
    assert.match(ui.prompts[0], /model=test-model/);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("streaming repl restores prompt once after all queued inputs drain", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-repl-queue-drain-"));
  try {
    const repl = new StreamingREPL(createAgent(stateDir));
    const ui = createUiRecorder();
    const firstGate = deferred();
    const firstStarted = deferred();
    const secondGate = deferred();
    const secondStarted = deferred();
    const seen = [];
    repl.ui = ui;
    repl.scheduler = {
      listTasks: async () => [],
      runDueTasksOnce: async () => {},
    };
    repl.goalController = {
      getGoalStatus: async () => null,
    };
    repl.processPrompt = async (input) => {
      seen.push(input);
      if (input === "first queued input") {
        firstStarted.resolve();
        await firstGate.promise;
      }
      if (input === "second queued input") {
        secondStarted.resolve();
        await secondGate.promise;
      }
    };

    const first = repl.handleUserInput("first queued input");
    await firstStarted.promise;
    const second = repl.handleUserInput("second queued input");

    assert.equal(ui.prompts.length, 0);

    firstGate.resolve();
    await secondStarted.promise;
    await Promise.resolve();

    assert.equal(ui.prompts.length, 0);

    secondGate.resolve();
    await Promise.all([first, second]);

    assert.deepEqual(seen, ["first queued input", "second queued input"]);
    assert.equal(ui.prompts.length, 1);
    assert.doesNotMatch(ui.prompts[0], /queue=/);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("streaming repl immediate queue status tolerates extra whitespace while input is running", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-repl-queue-status-spaces-"));
  const firstGate = deferred();
  const tracked = [];
  try {
    const repl = new StreamingREPL(createAgent(stateDir));
    const ui = createUiRecorder();
    const firstStarted = deferred();
    const seen = [];
    repl.ui = ui;
    repl.scheduler = {
      listTasks: async () => [],
      runDueTasksOnce: async () => {},
    };
    repl.goalController = {
      getGoalStatus: async () => null,
    };
    repl.processPrompt = async (input) => {
      seen.push(input);
      if (input === "active private prompt") {
        firstStarted.resolve();
        await firstGate.promise;
      }
    };

    const active = repl.handleUserInput("active private prompt");
    tracked.push(active);
    await firstStarted.promise;
    const status = repl.handleUserInput("/queue   status");
    tracked.push(status);

    await Promise.resolve();

    assert.equal(ui.validations.some((line) => /输入队列: running=yes pending=0 max=20/.test(line)), true);

    firstGate.resolve();
    await Promise.allSettled(tracked);

    assert.deepEqual(seen, ["active private prompt"]);
  } finally {
    firstGate.resolve();
    await Promise.allSettled(tracked);
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("streaming repl immediate queue clear tolerates extra whitespace without leaking body", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-repl-queue-clear-spaces-"));
  const firstGate = deferred();
  const tracked = [];
  try {
    const repl = new StreamingREPL(createAgent(stateDir));
    const ui = createUiRecorder();
    const firstStarted = deferred();
    const seen = [];
    repl.ui = ui;
    repl.scheduler = {
      listTasks: async () => [],
      runDueTasksOnce: async () => {},
    };
    repl.goalController = {
      getGoalStatus: async () => null,
    };
    repl.processPrompt = async (input) => {
      seen.push(input);
      if (input === "active private prompt") {
        firstStarted.resolve();
        await firstGate.promise;
      }
    };

    const active = repl.handleUserInput("active private prompt");
    tracked.push(active);
    await firstStarted.promise;
    const pending = repl.handleUserInput("SECRET_PENDING_PROMPT");
    tracked.push(pending);

    await Promise.resolve();
    const clear = repl.handleUserInput("/queue   clear");
    tracked.push(clear);
    await Promise.resolve();

    assert.equal(ui.validations.some((line) => /已清空|cleared/i.test(line)), true);
    assert.doesNotMatch(ui.validations.join("\n"), /SECRET_PENDING_PROMPT/);

    firstGate.resolve();
    await Promise.allSettled(tracked);

    assert.deepEqual(seen, ["active private prompt"]);
  } finally {
    firstGate.resolve();
    await Promise.allSettled(tracked);
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("streaming repl accepts chinese queue clear shorthand without running pending input", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-repl-queue-clear-cn-"));
  const firstGate = deferred();
  const tracked = [];
  try {
    const repl = new StreamingREPL(createAgent(stateDir));
    const ui = createUiRecorder();
    const firstStarted = deferred();
    const seen = [];
    repl.ui = ui;
    repl.scheduler = {
      listTasks: async () => [],
      runDueTasksOnce: async () => {},
    };
    repl.goalController = {
      getGoalStatus: async () => null,
    };
    repl.processPrompt = async (input) => {
      seen.push(input);
      if (input === "active private prompt") {
        firstStarted.resolve();
        await firstGate.promise;
      }
    };

    const active = repl.handleUserInput("active private prompt");
    tracked.push(active);
    await firstStarted.promise;
    const pending = repl.handleUserInput("中文秘密待处理输入");
    tracked.push(pending);

    await Promise.resolve();
    const clear = repl.handleUserInput("/清空队列");
    tracked.push(clear);
    await Promise.resolve();

    assert.equal(ui.validations.some((line) => /已清空|cleared/i.test(line)), true);
    assert.doesNotMatch(ui.validations.join("\n"), /中文秘密待处理输入/);

    firstGate.resolve();
    await Promise.allSettled(tracked);

    assert.deepEqual(seen, ["active private prompt"]);
  } finally {
    firstGate.resolve();
    await Promise.allSettled(tracked);
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("streaming repl handles unknown queue subcommand locally with usage", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-repl-queue-usage-"));
  try {
    const repl = new StreamingREPL(createAgent(stateDir));
    const ui = createUiRecorder();
    const seen = [];
    repl.ui = ui;
    repl.scheduler = {
      listTasks: async () => [],
      runDueTasksOnce: async () => {},
    };
    repl.goalController = {
      getGoalStatus: async () => null,
    };
    repl.processPrompt = async (input) => {
      seen.push(input);
    };

    await repl.handleUserInput("/queue later");

    assert.deepEqual(seen, []);
    assert.equal(ui.validations.some((line) => /用法|usage/i.test(line)), true);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("streaming repl immediate queue clear removes pending input without leaking body", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-repl-queue-clear-"));
  try {
    const repl = new StreamingREPL(createAgent(stateDir));
    const ui = createUiRecorder();
    const firstGate = deferred();
    const firstStarted = deferred();
    const seen = [];
    repl.ui = ui;
    repl.scheduler = {
      listTasks: async () => [],
      runDueTasksOnce: async () => {},
    };
    repl.goalController = {
      getGoalStatus: async () => null,
    };
    repl.processPrompt = async (input) => {
      seen.push(input);
      if (input === "active private prompt") {
        firstStarted.resolve();
        await firstGate.promise;
      }
    };

    const active = repl.handleUserInput("active private prompt");
    await firstStarted.promise;
    const pending = repl.handleUserInput("SECRET_PENDING_PROMPT");

    await Promise.resolve();
    assert.equal(ui.prompts.length, 0);

    await repl.handleUserInput("/queue clear");

    assert.equal(ui.validations.some((line) => /已清空|cleared/i.test(line)), true);
    assert.doesNotMatch(ui.validations.join("\n"), /SECRET_PENDING_PROMPT/);

    firstGate.resolve();
    await Promise.all([active, pending]);

    assert.deepEqual(seen, ["active private prompt"]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("streaming repl does not persist queue control commands to input history", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-repl-history-control-"));
  try {
    const repl = new StreamingREPL(createAgent(stateDir));
    const ui = createUiRecorder();
    const seen = [];
    repl.ui = ui;
    repl.scheduler = {
      listTasks: async () => [],
      runDueTasksOnce: async () => {},
    };
    repl.goalController = {
      getGoalStatus: async () => null,
    };
    repl.processPrompt = async (input) => {
      seen.push(input);
    };

    await repl.handleUserInput("/queue status");

    assert.deepEqual(seen, []);
    assert.equal(await pathExists(join(stateDir, "input-history.json")), false);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("streaming repl does not persist slash control commands to input history", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-repl-history-slash-"));
  try {
    const repl = new StreamingREPL(createAgent(stateDir));
    const ui = createUiRecorder();
    const seen = [];
    repl.ui = ui;
    repl.scheduler = {
      listTasks: async () => [],
      runDueTasksOnce: async () => {},
    };
    repl.goalController = {
      getGoalStatus: async () => null,
    };
    repl.processPrompt = async (input) => {
      seen.push(input);
    };

    await repl.handleUserInput("/sessions");

    assert.deepEqual(seen, []);
    assert.equal(await pathExists(join(stateDir, "input-history.json")), false);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("streaming repl routes slash command output through ui instead of console", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-repl-slash-output-"));
  const originalLog = console.log;
  const consoleLines = [];
  try {
    console.log = (line = "") => {
      consoleLines.push(String(line));
    };
    const repl = new StreamingREPL(createAgent(stateDir));
    const ui = createUiRecorder();
    repl.ui = ui;
    repl.scheduler = {
      listTasks: async () => [],
      runDueTasksOnce: async () => {},
    };
    repl.goalController = {
      getGoalStatus: async () => null,
    };
    repl.processPrompt = async () => {};

    await repl.handleUserInput("/sessions");

    assert.deepEqual(consoleLines, []);
    assert.equal(ui.outputs.some((line) => /已保存会话|\(无\)/.test(line)), true);
  } finally {
    console.log = originalLog;
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("streaming repl routes slash command errors through ui instead of console", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-repl-slash-error-"));
  const originalError = console.error;
  const consoleLines = [];
  try {
    console.error = (line = "") => {
      consoleLines.push(String(line));
    };
    const repl = new StreamingREPL(createAgent(stateDir));
    const ui = createUiRecorder();
    repl.ui = ui;

    repl.createSlashContext().writeError("slash error line");

    assert.deepEqual(consoleLines, []);
    assert.deepEqual(ui.errors, ["slash error line"]);
  } finally {
    console.error = originalError;
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("streaming repl persists real prompts to input history", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-repl-history-prompt-"));
  try {
    const repl = new StreamingREPL(createAgent(stateDir));
    const ui = createUiRecorder();
    const seen = [];
    repl.ui = ui;
    repl.scheduler = {
      listTasks: async () => [],
      runDueTasksOnce: async () => {},
    };
    repl.goalController = {
      getGoalStatus: async () => null,
    };
    repl.processPrompt = async (input) => {
      seen.push(input);
    };

    await repl.handleUserInput("real user prompt");

    assert.deepEqual(seen, ["real user prompt"]);
    assert.deepEqual(JSON.parse(await readFile(join(stateDir, "input-history.json"), "utf8")), ["real user prompt"]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
