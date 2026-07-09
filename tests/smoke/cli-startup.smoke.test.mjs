import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { parseCliArgs } from "../../dist/cli/startup-contract.js";

const ENTRY = join(process.cwd(), "dist/index.js");

test("cli startup matrix smoke: parser-level route mapping", () => {
  const matrix = [
    { args: [], mode: "chat" },
    { args: ["chat"], mode: "chat" },
    { args: ["repl"], mode: "repl" },
    { args: ["run", "修复 bug"], mode: "run" },
    { args: ["修复 bug"], mode: "run" },
    { args: ["--once", "修复 bug"], mode: "run" },
    { args: ["--help"], mode: "help" },
  ];

  for (const row of matrix) {
    const result = parseCliArgs(row.args);
    assert.equal(result.kind, "ok");
    assert.equal(result.mode, row.mode);
  }
});

test("cli startup smoke: --help exits with code 0 and prints contract", () => {
  const result = spawnSync(process.execPath, [ENTRY, "--help"], { encoding: "utf-8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /默认进入流式 TUI/);
  assert.match(result.stdout, /run "你的任务"/);
});

test("cli startup smoke: focused help exits with code 0 and keeps secrets private", () => {
  const result = spawnSync(process.execPath, [ENTRY, "help", "exports"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_LLM_API_KEY: "sk-focused-help-secret",
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /聚焦帮助/);
  assert.match(result.stdout, /Topic\s*: exports/);
  assert.match(result.stdout, /Usage\s*: qling exports \[count\]/);
  assert.match(result.stdout, /qling exports 20/);
  assert.match(result.stdout, /只读取本地文件元数据/);
  assert.doesNotMatch(result.stdout, /sk-focused-help-secret/);
});

test("cli startup smoke: help flag before topic prints focused local help", () => {
  const result = spawnSync(process.execPath, [ENTRY, "--help", "exports"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_LLM_API_KEY: "sk-help-flag-topic-secret",
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /聚焦帮助/);
  assert.match(result.stdout, /Topic\s*: exports/);
  assert.match(result.stdout, /Usage\s*: qling exports \[count\]/);
  assert.doesNotMatch(result.stdout, /sk-help-flag-topic-secret/);
  assert.doesNotMatch(result.stderr, /sk-help-flag-topic-secret/);
});

test("cli startup smoke: help flag after command prints focused local help", () => {
  const result = spawnSync(process.execPath, [ENTRY, "exports", "--help"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_LLM_API_KEY: "sk-command-help-flag-secret",
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /聚焦帮助/);
  assert.match(result.stdout, /Topic\s*: exports/);
  assert.match(result.stdout, /Usage\s*: qling exports \[count\]/);
  assert.doesNotMatch(result.stdout, /本地导出列表\n- /);
  assert.doesNotMatch(result.stdout, /sk-command-help-flag-secret/);
  assert.doesNotMatch(result.stderr, /sk-command-help-flag-secret/);
});

test("cli startup smoke: focused help typo suggests local topic without model run", () => {
  const result = spawnSync(process.execPath, [ENTRY, "help", "expors"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_LLM_API_KEY: "sk-focused-help-typo-secret",
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /未找到帮助主题 "expors"/);
  assert.match(result.stdout, /你是不是想看/);
  assert.match(result.stdout, /qling help exports/);
  assert.match(result.stdout, /Usage\s*: qling exports \[count\]/);
  assert.doesNotMatch(result.stdout, /sk-focused-help-typo-secret/);
  assert.doesNotMatch(result.stderr, /sk-focused-help-typo-secret/);
});

test("cli startup smoke: focused shortcuts help exits with code 0 and keeps static boundary", () => {
  const result = spawnSync(process.execPath, [ENTRY, "help", "shortcuts"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_LLM_API_KEY: "sk-shortcuts-help-secret",
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /聚焦帮助/);
  assert.match(result.stdout, /Topic\s*: shortcuts/);
  assert.match(result.stdout, /Usage\s*: qling shortcuts/);
  assert.match(result.stdout, /只读取本地静态快捷键说明/);
  assert.doesNotMatch(result.stdout, /sk-shortcuts-help-secret/);
  assert.doesNotMatch(result.stderr, /sk-shortcuts-help-secret/);
});

test("cli startup smoke: top-level typo suggests local command without model run", () => {
  const result = spawnSync(process.execPath, [ENTRY, "expors"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_LLM_API_KEY: "sk-cli-typo-secret",
    },
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /CLI_UNKNOWN_COMMAND_SUGGESTION/);
  assert.match(result.stderr, /你是不是想用/);
  assert.match(result.stderr, /qling exports/);
  assert.match(result.stderr, /qling help exports/);
  assert.match(result.stderr, /qling run "expors"/);
  assert.doesNotMatch(result.stderr, /sk-cli-typo-secret/);
  assert.doesNotMatch(result.stdout, /sk-cli-typo-secret/);
});

test("cli startup smoke: doctor exits with code 0 and prints local diagnostics", () => {
  const result = spawnSync(process.execPath, [ENTRY, "doctor"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_LLM_API_KEY: "sk-doctor-smoke-secret",
      QLING_MCP_SERVERS: JSON.stringify({
        docs: {
          command: "",
          args: [],
          enabled: true,
          transport: "http",
          url: "https://user:pass@example.com/mcp?token=doctor-smoke-secret",
          headers: { Authorization: "Bearer doctor-smoke-secret" },
        },
      }),
    },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /轻灵 Doctor/);
  assert.match(result.stdout, /workspace/);
  assert.match(result.stdout, /config/);
  assert.match(result.stdout, /MCP/);
  assert.match(result.stdout, /hooks/);
  assert.match(result.stdout, /本地/);
  assert.doesNotMatch(result.stdout, /sk-doctor-smoke-secret/);
  assert.doesNotMatch(result.stdout, /doctor-smoke-secret/);
  assert.doesNotMatch(result.stdout, /user:pass/);
});

test("cli startup smoke: status exits with code 0 and prints local status without secrets", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-status-"));
  try {
    mkdirSync(join(root, "sessions"), { recursive: true });
    mkdirSync(join(root, "exports"), { recursive: true });
    writeFileSync(join(root, "sessions", "session.json"), "SECRET_STATUS_SESSION_BODY", "utf8");
    writeFileSync(join(root, "exports", "export.md"), "SECRET_STATUS_EXPORT_BODY", "utf8");
    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "状态"], {
      encoding: "utf-8",
      env: {
        ...process.env,
        QLING_LLM_MODEL: "smoke-status-model",
        QLING_LLM_API_KEY: "sk-status-smoke-secret",
        QLING_LLM_ENDPOINT: "https://user:pass@example.com/v1?token=status-smoke-secret",
      },
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /本地状态/);
    assert.match(result.stdout, /model=smoke-status-model/);
    assert.match(result.stdout, /api_key=set\(redacted\)/);
    assert.match(result.stdout, /endpoint=https:\/\/example\.com\/v1/);
    assert.match(result.stdout, /sessions=1/);
    assert.match(result.stdout, /exports=1/);
    assert.doesNotMatch(result.stdout, /sk-status-smoke-secret/);
    assert.doesNotMatch(result.stdout, /status-smoke-secret/);
    assert.doesNotMatch(result.stdout, /SECRET_STATUS_SESSION_BODY/);
    assert.doesNotMatch(result.stdout, /SECRET_STATUS_EXPORT_BODY/);
    assert.doesNotMatch(result.stdout, /user:pass/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: storage exits with code 0 and prints local storage report", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-storage-"));
  try {
    mkdirSync(join(root, "sessions"), { recursive: true });
    writeFileSync(join(root, "sessions", "session.json"), "SECRET_CLI_STORAGE_BODY", "utf8");
    const result = spawnSync(process.execPath, [ENTRY, "storage", "--file-state-dir", root], {
      encoding: "utf-8",
      env: {
        ...process.env,
        QLING_FILE_STATE_DIR: root,
        QLING_FILE_CACHE_DIR: join(root, "cache"),
      },
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /本地存储盘点/);
    assert.match(result.stdout, /sessions/i);
    assert.match(result.stdout, /Size\s*:/);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_STORAGE_BODY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: storage clean dry-run reports candidates without deleting", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-storage-clean-dry-"));
  try {
    mkdirSync(join(root, "sessions"), { recursive: true });
    mkdirSync(join(root, "cache"), { recursive: true });
    writeFileSync(join(root, "tmp_fetch.ps1"), "Write-Host temp", "utf8");
    writeFileSync(join(root, ".env"), "DEEPSEEK_API_KEY=sk-storage-secret", "utf8");
    writeFileSync(join(root, "sessions", "session.json"), "SECRET_STORAGE_SESSION_BODY", "utf8");
    writeFileSync(join(root, "cache", "scratch.txt"), "cache", "utf8");

    const result = spawnSync(process.execPath, [ENTRY, "storage", "clean", "--dry-run"], {
      encoding: "utf-8",
      env: {
        ...process.env,
        QLING_FILE_STATE_DIR: root,
        QLING_FILE_CACHE_DIR: join(root, "cache"),
      },
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /storage clean --dry-run/);
    assert.match(result.stdout, /tmp_fetch\.ps1/);
    assert.match(result.stdout, /scratch\.txt/);
    assert.doesNotMatch(result.stdout, /SECRET_STORAGE_SESSION_BODY/);
    assert.doesNotMatch(result.stdout, /sk-storage-secret/);
    assert.equal(existsSync(join(root, "tmp_fetch.ps1")), true);
    assert.equal(existsSync(join(root, "cache", "scratch.txt")), true);
    assert.equal(existsSync(join(root, ".env")), true);
    assert.equal(existsSync(join(root, "sessions", "session.json")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: storage clean yes removes only safe candidates", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-storage-clean-yes-"));
  try {
    mkdirSync(join(root, "sessions"), { recursive: true });
    mkdirSync(join(root, "cache"), { recursive: true });
    writeFileSync(join(root, "tmp_fetch.py"), "print('temp')", "utf8");
    writeFileSync(join(root, ".env"), "OPENAI_API_KEY=sk-storage-secret", "utf8");
    writeFileSync(join(root, "sessions", "session.json"), "SECRET_STORAGE_SESSION_BODY", "utf8");
    writeFileSync(join(root, "cache", "scratch.txt"), "cache", "utf8");

    const result = spawnSync(process.execPath, [ENTRY, "storage", "clean", "--yes"], {
      encoding: "utf-8",
      env: {
        ...process.env,
        QLING_FILE_STATE_DIR: root,
        QLING_FILE_CACHE_DIR: join(root, "cache"),
      },
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /storage clean 已执行/);
    assert.match(result.stdout, /sessions、memory、guard\/audit、\.env 未被触碰/);
    assert.doesNotMatch(result.stdout, /SECRET_STORAGE_SESSION_BODY/);
    assert.doesNotMatch(result.stdout, /sk-storage-secret/);
    assert.equal(existsSync(join(root, "tmp_fetch.py")), false);
    assert.equal(existsSync(join(root, "cache", "scratch.txt")), false);
    assert.equal(existsSync(join(root, ".env")), true);
    assert.equal(existsSync(join(root, "sessions", "session.json")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: exports exits with code 0 and prints local export index", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-exports-"));
  try {
    const exportsDir = join(root, "exports");
    mkdirSync(exportsDir, { recursive: true });
    writeFileSync(join(exportsDir, "session-latest.md"), "SECRET_CLI_EXPORT_BODY", "utf8");
    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "exports", "1"], {
      encoding: "utf-8",
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /本地导出列表/);
    assert.match(result.stdout, /session-latest\.md/);
    assert.match(result.stdout, /文件名\s*:/);
    assert.match(result.stdout, /修改时间\s*:/);
    assert.match(result.stdout, /大小\s*:/);
    assert.match(result.stdout, /绝对路径\s*:/);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_EXPORT_BODY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: sessions exits with code 0 and prints local session summaries", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-sessions-"));
  try {
    const sessionsDir = join(root, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "session-local.json"),
      JSON.stringify(
        {
          version: 1,
          name: "session-local",
          sessionId: "sid-local",
          workspaceDir: "C:/repo/qling",
          createdAt: "2026-05-31T00:00:00.000Z",
          updatedAt: "2026-05-31T00:01:00.000Z",
          messages: [{ role: "user", content: "SECRET_CLI_SESSION_BODY" }],
          turnCount: 4,
          sessionTokens: 256,
          compactionCount: 1,
        },
        null,
        2
      ),
      "utf8"
    );
    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "sessions", "1"], {
      encoding: "utf-8",
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /本地会话列表/);
    assert.match(result.stdout, /session-local/);
    assert.match(result.stdout, /sid-local/);
    assert.match(result.stdout, /messages=1/);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_SESSION_BODY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: checkpoint copies latest local session without body leak", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-checkpoint-"));
  try {
    const sessionsDir = join(root, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "session-local.json"),
      JSON.stringify(
        {
          version: 1,
          name: "session-local",
          sessionId: "sid-local-checkpoint",
          workspaceDir: "C:/repo/qling",
          createdAt: "2026-05-31T00:00:00.000Z",
          updatedAt: "2026-05-31T00:01:00.000Z",
          messages: [{ role: "user", content: "SECRET_CLI_CHECKPOINT_BODY" }],
          turnCount: 4,
          sessionTokens: 256,
          compactionCount: 1,
        },
        null,
        2
      ),
      "utf8"
    );

    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "checkpoint", "before-refactor"], {
      encoding: "utf-8",
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /本地会话检查点/);
    assert.match(result.stdout, /session-local/);
    assert.match(result.stdout, /before-refactor/);
    assert.match(result.stdout, /sid-local-checkpoint/);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_CHECKPOINT_BODY/);
    assert.equal(existsSync(join(sessionsDir, "before-refactor.json")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: checkpoint refuses existing name unless forced", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-checkpoint-guard-"));
  try {
    const sessionsDir = join(root, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    const source = {
      version: 1,
      name: "session-local",
      sessionId: "sid-local-checkpoint-guard",
      workspaceDir: "C:/repo/qling",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:01:00.000Z",
      messages: [{ role: "user", content: "SECRET_CLI_CHECKPOINT_GUARD_BODY" }],
      turnCount: 4,
      sessionTokens: 256,
      compactionCount: 1,
    };
    writeFileSync(join(sessionsDir, "session-local.json"), JSON.stringify(source, null, 2), "utf8");
    writeFileSync(
      join(sessionsDir, "existing.json"),
      JSON.stringify(
        {
          ...source,
          name: "existing",
          sessionId: "sid-existing-checkpoint",
          messages: [{ role: "assistant", content: "ORIGINAL_EXISTING_BODY" }],
          updatedAt: "2026-05-30T00:00:00.000Z",
        },
        null,
        2
      ),
      "utf8"
    );

    const denied = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "checkpoint", "existing"], {
      encoding: "utf-8",
    });

    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /已存在|exists/i);
    assert.match(denied.stderr, /--force/);
    assert.doesNotMatch(denied.stderr, /SECRET_CLI_CHECKPOINT_GUARD_BODY/);
    assert.doesNotMatch(readFileSync(join(sessionsDir, "existing.json"), "utf8"), /sid-local-checkpoint-guard/);

    const forced = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "checkpoint", "existing", "--force"], {
      encoding: "utf-8",
    });

    assert.equal(forced.status, 0);
    assert.match(forced.stdout, /existing/);
    assert.doesNotMatch(forced.stdout, /SECRET_CLI_CHECKPOINT_GUARD_BODY/);
    assert.match(readFileSync(join(sessionsDir, "existing.json"), "utf8"), /sid-local-checkpoint-guard/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: tasks exits with code 0 and prints local task metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-tasks-"));
  try {
    const tasksDir = join(root, "session-tasks");
    const sessionsDir = join(root, "sessions");
    mkdirSync(tasksDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(tasksDir, "session-task.json"),
      JSON.stringify(
        [
          {
            id: "tsk_cli_list",
            kind: "loop",
            prompt: "list local task metadata",
            intervalMs: 60000,
            mode: "fixed",
            runner: "daemon",
            status: "active",
            pending: false,
            createdAt: 1000,
            updatedAt: 2000,
            nextRunAt: 61000,
          },
        ],
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(join(sessionsDir, "session-task.json"), "SECRET_CLI_TASK_SESSION_BODY", "utf8");

    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "tasks", "list"], {
      encoding: "utf-8",
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /本地任务列表/);
    assert.match(result.stdout, /tsk_cli_list/);
    assert.match(result.stdout, /session-task/);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_TASK_SESSION_BODY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: chinese tasks cancel updates local task status", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-tasks-cn-"));
  try {
    const tasksDir = join(root, "session-tasks");
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(
      join(tasksDir, "session-cancel.json"),
      JSON.stringify(
        [
          {
            id: "tsk_cli_cancel",
            kind: "loop",
            prompt: "cancel local task",
            intervalMs: 60000,
            mode: "fixed",
            runner: "daemon",
            status: "running",
            pending: true,
            createdAt: 1000,
            updatedAt: 2000,
            nextRunAt: 61000,
          },
        ],
        null,
        2
      ),
      "utf8"
    );

    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "任务", "取消", "tsk_cli_cancel"], {
      encoding: "utf-8",
    });
    const persisted = JSON.parse(readFileSync(join(tasksDir, "session-cancel.json"), "utf8"));

    assert.equal(result.status, 0);
    assert.match(result.stdout, /已取消本地任务/);
    assert.equal(persisted[0].status, "canceled");
    assert.equal(persisted[0].pending, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: goal status exits with code 0 and prints local goals", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-goal-status-"));
  try {
    const goalsDir = join(root, "session-goals");
    const sessionsDir = join(root, "sessions");
    mkdirSync(goalsDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "session-goal.json"), "SECRET_CLI_GOAL_SESSION_BODY", "utf8");
    writeFileSync(
      join(goalsDir, "session-goal.json"),
      JSON.stringify(
        {
          condition: "完成本地验收",
          status: "active",
          runner: "daemon",
          pending: true,
          createdAt: 1000,
          updatedAt: 2000,
          baselineTurns: 1,
          baselineTokens: 10,
          evaluatedTurns: 0,
          lastReason: "goal_activated",
          lastDecision: null,
        },
        null,
        2
      ),
      "utf8"
    );

    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "goal", "status"], {
      encoding: "utf-8",
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /本地目标列表/);
    assert.match(result.stdout, /session-goal/);
    assert.match(result.stdout, /完成本地验收/);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_GOAL_SESSION_BODY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: chinese goal set writes daemon goal for latest session", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-goal-set-cn-"));
  try {
    const sessionsDir = join(root, "sessions");
    const goalsDir = join(root, "session-goals");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "session-latest.json"),
      JSON.stringify(
        {
          version: 1,
          name: "session-latest",
          sessionId: "session-latest",
          workspaceDir: "C:/repo/qling",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:05:00.000Z",
          messages: [{ role: "user", content: "SECRET_CLI_GOAL_SET_BODY" }],
          turnCount: 8,
          sessionTokens: 512,
          compactionCount: 0,
        },
        null,
        2
      ),
      "utf8"
    );

    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "目标", "设置", "完成 ci"], {
      encoding: "utf-8",
    });
    const persisted = JSON.parse(readFileSync(join(goalsDir, "session-latest.json"), "utf8"));

    assert.equal(result.status, 0);
    assert.match(result.stdout, /已设置本地目标/);
    assert.equal(persisted.condition, "完成 ci");
    assert.equal(persisted.runner, "daemon");
    assert.equal(persisted.pending, true);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_GOAL_SET_BODY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: goal clear latest updates local goal status", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-goal-clear-"));
  try {
    const sessionsDir = join(root, "sessions");
    const goalsDir = join(root, "session-goals");
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(goalsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "session-clear.json"),
      JSON.stringify(
        {
          version: 1,
          name: "session-clear",
          sessionId: "session-clear",
          workspaceDir: "C:/repo/qling",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:05:00.000Z",
          messages: [],
          turnCount: 2,
          sessionTokens: 64,
          compactionCount: 0,
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      join(goalsDir, "session-clear.json"),
      JSON.stringify(
        {
          condition: "待清除",
          status: "active",
          runner: "daemon",
          pending: true,
          createdAt: 1000,
          updatedAt: 2000,
          baselineTurns: 1,
          baselineTokens: 10,
          evaluatedTurns: 0,
          lastReason: "goal_activated",
          lastDecision: null,
        },
        null,
        2
      ),
      "utf8"
    );

    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "goal", "clear", "latest"], {
      encoding: "utf-8",
    });
    const persisted = JSON.parse(readFileSync(join(goalsDir, "session-clear.json"), "utf8"));

    assert.equal(result.status, 0);
    assert.match(result.stdout, /已清除本地目标/);
    assert.equal(persisted.status, "cleared");
    assert.equal(persisted.pending, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: memory status exits with code 0 and prints local memory index", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-memory-"));
  try {
    const memoryDir = join(root, "memory");
    const sessionsDir = join(root, "sessions");
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "session.json"), "SECRET_CLI_MEMORY_SESSION_BODY", "utf8");
    writeFileSync(
      join(memoryDir, "memory.json"),
      JSON.stringify(
        [
          {
            id: "mem_cli_1",
            content: "cli local memory",
            source: "manual",
            createdAt: 2000,
            importance: 0.8,
          },
        ],
        null,
        2
      ),
      "utf8"
    );

    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "memory", "status"], {
      encoding: "utf-8",
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /本地记忆/);
    assert.match(result.stdout, /mem_cli_1/);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_MEMORY_SESSION_BODY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: chinese memory alias shows local memory detail", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-memory-cn-"));
  try {
    const memoryDir = join(root, "memory");
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(
      join(memoryDir, "memory.json"),
      JSON.stringify(
        [
          {
            id: "mem_cli_show",
            content: "本地记忆详情",
            source: "manual",
            createdAt: 2000,
            importance: 0.8,
          },
        ],
        null,
        2
      ),
      "utf8"
    );

    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "记忆", "查看", "mem_cli_show"], {
      encoding: "utf-8",
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /mem_cli_show/);
    assert.match(result.stdout, /本地记忆详情/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: memory search exits with code 0 and keeps session body private", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-memory-search-"));
  try {
    const memoryDir = join(root, "memory");
    const sessionsDir = join(root, "sessions");
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "session.json"), "SECRET_CLI_MEMORY_SEARCH_SESSION_BODY", "utf8");
    writeFileSync(
      join(memoryDir, "memory.json"),
      JSON.stringify(
        [
          {
            id: "mem_cli_search",
            content: "cli searchable local memory",
            source: "manual",
            createdAt: 2000,
            importance: 0.8,
          },
        ],
        null,
        2
      ),
      "utf8"
    );

    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "memory", "search", "searchable", "1"], {
      encoding: "utf-8",
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /本地记忆搜索/);
    assert.match(result.stdout, /mem_cli_search/);
    assert.match(result.stdout, /content:searchable/);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_MEMORY_SEARCH_SESSION_BODY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: memory practices exits with code 0 and keeps session body private", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-memory-practices-"));
  try {
    const memoryDir = join(root, "memory");
    const sessionsDir = join(root, "sessions");
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "session.json"), "SECRET_CLI_MEMORY_PRACTICE_SESSION_BODY", "utf8");

    const db = new Database(join(memoryDir, "cognitive_knowledge.db"));
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
        VALUES ('prac_cli', 'cli practice', '["npm run ci:check"]', '["src/index.ts"]', 0.95, 5, 2000);
      `);
    } finally {
      db.close();
    }

    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "memory", "practices", "1"], {
      encoding: "utf-8",
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /本地蒸馏实践/);
    assert.match(result.stdout, /prac_cli/);
    assert.match(result.stdout, /cli practice/);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_MEMORY_PRACTICE_SESSION_BODY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: memory graph exits with code 0 and keeps session body private", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-memory-graph-"));
  try {
    const memoryDir = join(root, "memory");
    const sessionsDir = join(root, "sessions");
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "session.json"), "SECRET_CLI_MEMORY_GRAPH_SESSION_BODY", "utf8");

    const db = new Database(join(memoryDir, "cognitive_knowledge.db"));
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
          ('kg_cli_task', 'task', 'cli graph task', '{"secret":"hidden"}', 3000),
          ('kg_cli_file', 'file', 'src/index.ts', '{}', 2000);
        INSERT INTO kg_edges (source, target, relation, weight)
        VALUES ('kg_cli_task', 'kg_cli_file', 'uses', 1.0);
      `);
    } finally {
      db.close();
    }

    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "memory", "graph", "1"], {
      encoding: "utf-8",
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /本地知识图谱/);
    assert.match(result.stdout, /kg_cli_task/);
    assert.match(result.stdout, /cli graph task/);
    assert.match(result.stdout, /uses -> src\/index\.ts/);
    assert.doesNotMatch(result.stdout, /hidden/);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_MEMORY_GRAPH_SESSION_BODY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: privacy exits with code 0 and prints local privacy boundary", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-privacy-"));
  try {
    const sessionsDir = join(root, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "session-local.json"),
      JSON.stringify(
        {
          version: 1,
          name: "session-local",
          sessionId: "sid-local",
          workspaceDir: "C:/repo/qling",
          createdAt: "2026-05-31T00:00:00.000Z",
          updatedAt: "2026-05-31T00:01:00.000Z",
          messages: [{ role: "user", content: "SECRET_CLI_PRIVACY_BODY" }],
          turnCount: 1,
          sessionTokens: 42,
          compactionCount: 0,
        },
        null,
        2
      ),
      "utf8"
    );
    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "privacy"], {
      encoding: "utf-8",
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /本地数据留存/);
    assert.match(result.stdout, /已存快照\s*: 1/);
    assert.match(result.stdout, /模型请求仍按 provider 配置发送/);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_PRIVACY_BODY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: chinese privacy alias exits with code 0 and keeps body private", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-privacy-cn-"));
  try {
    const sessionsDir = join(root, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "session-local.json"),
      JSON.stringify(
        {
          version: 1,
          name: "session-local",
          sessionId: "sid-local",
          workspaceDir: "C:/repo/qling",
          createdAt: "2026-05-31T00:00:00.000Z",
          updatedAt: "2026-05-31T00:01:00.000Z",
          messages: [{ role: "user", content: "SECRET_CLI_CN_PRIVACY_BODY" }],
          turnCount: 1,
          sessionTokens: 42,
          compactionCount: 0,
        },
        null,
        2
      ),
      "utf8"
    );
    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "隐私"], {
      encoding: "utf-8",
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /本地数据留存/);
    assert.match(result.stdout, /已存快照\s*: 1/);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_CN_PRIVACY_BODY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: chinese context alias exits with code 0 and keeps body private", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-context-cn-"));
  try {
    const sessionsDir = join(root, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "session-local.json"),
      JSON.stringify(
        {
          version: 1,
          name: "session-local",
          sessionId: "sid-local",
          workspaceDir: "C:/repo/qling",
          createdAt: "2026-05-31T00:00:00.000Z",
          updatedAt: "2026-05-31T00:01:00.000Z",
          messages: [{ role: "user", content: "SECRET_CLI_CN_CONTEXT_BODY" }],
          turnCount: 3,
          sessionTokens: 128,
          compactionCount: 0,
        },
        null,
        2
      ),
      "utf8"
    );
    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "上下文"], {
      encoding: "utf-8",
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /本地上下文/);
    assert.match(result.stdout, /已存快照\s*: 1/);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_CN_CONTEXT_BODY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: chinese shortcuts alias exits with code 0 and prints local shortcut help", () => {
  const result = spawnSync(process.execPath, [ENTRY, "快捷键"], {
    encoding: "utf-8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /TUI 快捷键/);
  assert.match(result.stdout, /Ctrl\+N/);
  assert.match(result.stdout, /Ctrl\+R/);
  assert.match(result.stdout, /Alt\+←/);
  assert.match(result.stdout, /按词/);
  assert.match(result.stdout, /Ctrl\+W/);
  assert.match(result.stdout, /Ctrl\+L/);
  assert.match(result.stdout, /不丢弃正在编辑的内容/);
  assert.match(result.stdout, /Ctrl\+D/);
  assert.match(result.stdout, /Home \/ End/);
  assert.match(result.stdout, /Paste/);
  assert.match(result.stdout, /不会自动发送/);
  assert.match(result.stdout, /恢复未发送草稿/);
  assert.match(result.stdout, /只作用于本地 TUI 输入缓冲/);
});

test("cli startup smoke: chinese statusline alias exits with code 0 and prints local statusline", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-statusline-cn-"));
  try {
    const stateDir = join(root, "state");
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(stateDir, "sessions"), { recursive: true });
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    writeFileSync(join(stateDir, "sessions", "session.json"), "SECRET_STATUSLINE_SESSION_BODY", "utf8");
    const result = spawnSync(process.execPath, [ENTRY, "--workspace", root, "--file-state-dir", stateDir, "--model", "local-status", "状态线"], {
      encoding: "utf-8",
      env: {
        ...process.env,
        QLING_STATUSLINE_COST_PER_1K_TOKENS: "0.002",
        QLING_LLM_API_KEY: "sk-statusline-smoke-secret",
      },
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /statusline/);
    assert.match(result.stdout, /模型=local-status/);
    assert.match(result.stdout, /会话=-/);
    assert.match(result.stdout, /分支=main/);
    assert.match(result.stdout, /令牌=0/);
    assert.match(result.stdout, /in=0/);
    assert.match(result.stdout, /out=0/);
    assert.doesNotMatch(result.stdout, /上下文=/);
    assert.match(result.stdout, /成本≈\$0\.0000/);
    assert.doesNotMatch(result.stdout, /SECRET_STATUSLINE_SESSION_BODY/);
    assert.doesNotMatch(result.stdout, /sk-statusline-smoke-secret/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: recap exits with code 0 and reads local saved session", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-recap-"));
  try {
    const sessionsDir = join(root, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "session-local.json"),
      JSON.stringify(
        {
          version: 1,
          name: "session-local",
          sessionId: "sid-local-recap",
          workspaceDir: "C:/repo/qling",
          createdAt: "2026-05-31T00:00:00.000Z",
          updatedAt: "2026-05-31T00:01:00.000Z",
          messages: [
            { role: "user", content: "older local recap body" },
            { role: "assistant", content: "latest local recap body" },
          ],
          turnCount: 2,
          sessionTokens: 512,
          compactionCount: 0,
        },
        null,
        2
      ),
      "utf8"
    );
    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "recap", "1"], {
      encoding: "utf-8",
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /本地会话回顾/);
    assert.match(result.stdout, /sid-local-recap/);
    assert.match(result.stdout, /assistant: latest local recap body/);
    assert.doesNotMatch(result.stdout, /older local recap body/);
    assert.match(result.stdout, /只读取本地已保存会话快照/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: permissions exits with code 0 and prints local permission mode", () => {
  const result = spawnSync(process.execPath, [ENTRY, "权限"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_PERMISSIONS_MODE: "ask",
      QLING_GUARD_PERMISSIONS_DEFAULT: undefined,
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /本地权限状态/);
  assert.match(result.stdout, /Default\s*:\s*询问\(确认\)/);
  assert.match(result.stdout, /QLING_PERMISSIONS_MODE=ask/);
  assert.match(result.stdout, /不修改配置/);
});

test("cli startup smoke: permissions explain exits with code 0 and keeps secrets private", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-cli-permissions-explain-"));
  try {
    mkdirSync(join(root, "sessions"), { recursive: true });
    writeFileSync(join(root, "sessions", "session.json"), "SECRET_PERMISSIONS_EXPLAIN_SESSION_BODY", "utf8");

    const result = spawnSync(process.execPath, [ENTRY, "--file-state-dir", root, "permissions", "explain", "bash"], {
      encoding: "utf-8",
      env: {
        ...process.env,
        QLING_GUARD_PERMISSIONS_DEFAULT: "allow",
        QLING_GUARD_PERMISSIONS_RULES: JSON.stringify([
          { tool_pattern: "bash", decision: "ask", reason: "shell requires review" },
        ]),
        QLING_LLM_API_KEY: "sk-permissions-explain-smoke-secret",
      },
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /权限解释/);
    assert.match(result.stdout, /Tool\s*: bash/);
    assert.match(result.stdout, /Decision\s*:\s*询问\(确认\)/);
    assert.match(result.stdout, /Matched\s*: bash/);
    assert.match(result.stdout, /shell requires review/);
    assert.doesNotMatch(result.stdout, /SECRET_PERMISSIONS_EXPLAIN_SESSION_BODY/);
    assert.doesNotMatch(result.stdout, /sk-permissions-explain-smoke-secret/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli startup smoke: config exits with code 0 and redacts local secrets", () => {
  const result = spawnSync(process.execPath, [ENTRY, "配置"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_LLM_MODEL: "local-config-model",
      QLING_LLM_API_KEY: "sk-smoke-secret",
      QLING_LLM_ENDPOINT: "https://user:pass@example.com/v1?token=smoke-secret",
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /本地配置摘要/);
  assert.match(result.stdout, /Model\s*: local-config-model/);
  assert.match(result.stdout, /Api key\s*: set\(redacted\)/);
  assert.match(result.stdout, /Endpoint\s*: https:\/\/example\.com\/v1/);
  assert.doesNotMatch(result.stdout, /sk-smoke-secret/);
  assert.doesNotMatch(result.stdout, /smoke-secret/);
  assert.doesNotMatch(result.stdout, /user:pass/);
});

test("cli startup smoke: mcp exits with code 0 and redacts local mcp secrets", () => {
  const result = spawnSync(process.execPath, [ENTRY, "MCP"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_MCP_SERVERS: JSON.stringify({
        docs: {
          command: "",
          args: [],
          enabled: true,
          transport: "http",
          url: "https://user:pass@example.com/mcp?token=smoke-secret",
          headers: {
            Authorization: "Bearer smoke-secret",
          },
        },
      }),
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /本地 MCP 配置/);
  assert.match(result.stdout, /docs/);
  assert.match(result.stdout, /enabled=1\/1/);
  assert.match(result.stdout, /url=https:\/\/example\.com\/mcp/);
  assert.match(result.stdout, /Authorization=set\(redacted\)/);
  assert.doesNotMatch(result.stdout, /smoke-secret/);
  assert.doesNotMatch(result.stdout, /user:pass/);
});

test("cli startup smoke: hooks exits with code 0 and redacts local hook patterns", () => {
  const result = spawnSync(process.execPath, [ENTRY, "钩子"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_GUARD_ENABLED: "true",
      QLING_GUARD_RATE_LIMIT_ENABLED: "true",
      QLING_GUARD_RATE_LIMIT_MAX_PER_MINUTE: "9",
      QLING_GUARD_CONTENT_FILTER_ENABLED: "true",
      QLING_GUARD_CONTENT_FILTER_CUSTOM: JSON.stringify(["SECRET_HOOK_PATTERN"]),
      QLING_GUARD_REDACTION_PATTERNS: JSON.stringify(["SECRET_REDACTION_PATTERN"]),
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /本地 Hooks 状态/);
  assert.match(result.stdout, /Guard\s*: on/);
  assert.match(result.stdout, /rate_limit=on\(9\/min\)/);
  assert.match(result.stdout, /custom=1/);
  assert.match(result.stdout, /patterns=1/);
  assert.doesNotMatch(result.stdout, /SECRET_HOOK_PATTERN/);
  assert.doesNotMatch(result.stdout, /SECRET_REDACTION_PATTERN/);
});

test("cli startup smoke: conflict exits with code 2 and coded error", () => {
  const result = spawnSync(process.execPath, [ENTRY, "repl", "--once", "x"], {
    encoding: "utf-8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CLI_INVALID_MODE_COMBINATION/);
});

test("cli startup smoke: --once missing task exits with code 2", () => {
  const result = spawnSync(process.execPath, [ENTRY, "--once"], { encoding: "utf-8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CLI_MISSING_TASK/);
});
