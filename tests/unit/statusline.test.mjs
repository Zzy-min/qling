import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  collectLocalStatusLineSnapshot,
  collectStatusLineSnapshot,
  formatPermissionMode,
  formatStatusLine,
  resolveShortSessionId,
} from "../../dist/statusline.js";

test("statusline formatter includes local interaction state", () => {
  const line = formatStatusLine({
    model: "deepseek-chat",
    sessionId: "session_1234567890abcdef",
    branch: "main",
    permissionMode: "ask",
    goalStatus: "active",
    activeTasks: 2,
    tokens: 12345,
    tokenSource: "provider",
    maxTokens: 120000,
    costPer1kTokens: 0.002,
  });

  assert.match(line, /模型=deepseek-chat/);
  assert.match(line, /会话=session_1/);
  assert.match(line, /分支=main/);
  assert.match(line, /权限=询问\(确认\)/);
  assert.match(line, /目标=active/);
  assert.match(line, /任务=2/);
  assert.match(line, /令牌=12,345/);
  assert.match(line, /来源=provider/);
  assert.match(line, /上下文=12,345\/120,000\(10%\)/);
  assert.match(line, /成本≈\$0\.0247/);
});

test("statusline formatter degrades when optional fields are absent", () => {
  const line = formatStatusLine({
    model: "unknown",
    sessionId: "",
    branch: null,
    permissionMode: null,
    goalStatus: null,
    activeTasks: 0,
    tokens: 0,
  });

  assert.match(line, /模型=unknown/);
  assert.match(line, /会话=-/);
  assert.match(line, /分支=-/);
  assert.match(line, /权限=-\(未知\)/);
  assert.match(line, /目标=无/);
  assert.match(line, /任务=0/);
  assert.match(line, /令牌=0/);
  assert.match(line, /来源=unknown/);
  assert.match(line, /上下文=0\/-/);
  assert.match(line, /成本=-/);
  assert.doesNotMatch(line, /queue=/);
});

test("statusline formatter shows pending input queue without input bodies", () => {
  const line = formatStatusLine({
    model: "deepseek-chat",
    sessionId: "session_queue_private",
    branch: "main",
    permissionMode: "ask",
    goalStatus: null,
    activeTasks: 0,
    tokens: 10,
    inputQueue: {
      pendingCount: 2,
      maxPending: 20,
      isProcessing: true,
    },
  });

  assert.match(line, /队列=2\/20/);
  assert.doesNotMatch(line, /private/i);
});

test("statusline formatter shows active input processing when no input is pending", () => {
  const line = formatStatusLine({
    model: "deepseek-chat",
    sessionId: "session_queue_active",
    branch: "main",
    permissionMode: "ask",
    goalStatus: null,
    activeTasks: 0,
    tokens: 10,
    inputQueue: {
      pendingCount: 0,
      maxPending: 20,
      isProcessing: true,
    },
  });

  assert.match(line, /队列=run\/20/);
});

test("statusline formatter omits idle input queue", () => {
  const line = formatStatusLine({
    model: "deepseek-chat",
    sessionId: "session_queue_idle",
    branch: "main",
    permissionMode: "ask",
    goalStatus: null,
    activeTasks: 0,
    tokens: 10,
    inputQueue: {
      pendingCount: 0,
      maxPending: 20,
      isProcessing: false,
    },
  });

  assert.doesNotMatch(line, /queue=/);
});

test("statusline snapshot collects input queue metadata from slash context", async () => {
  const snapshot = await collectStatusLineSnapshot({
    agentLoop: {
      getModel: () => "deepseek-chat",
      getSessionStats: () => ({ sessionId: "session_queue_snapshot", tokens: 88 }),
      getTokenBudget: () => ({ maxTokens: 120000 }),
      getPermissionMode: () => "ask",
    },
    scheduler: {
      listTasks: async () => [],
    },
    goalController: {
      getGoalStatus: async () => null,
    },
    inputQueue: {
      pendingCount: 3,
      maxPending: 20,
      isProcessing: true,
    },
    writeLine: () => {},
    writeError: () => {},
  });

  assert.deepEqual(snapshot.inputQueue, {
    pendingCount: 3,
    maxPending: 20,
    isProcessing: true,
  });
  assert.equal(snapshot.maxTokens, 120000);
  assert.equal(snapshot.tokenSource, "unknown");
});

test("statusline snapshot reads local cost estimate from env", async () => {
  const previous = process.env.QLING_STATUSLINE_COST_PER_1K_TOKENS;
  process.env.QLING_STATUSLINE_COST_PER_1K_TOKENS = "0.002";
  try {
    const snapshot = await collectStatusLineSnapshot({
      agentLoop: {
        getModel: () => "deepseek-chat",
        getSessionStats: () => ({ sessionId: "session_cost_snapshot", tokens: 12000 }),
        getTokenBudget: () => ({ maxTokens: 120000 }),
        getPermissionMode: () => "ask",
      },
      scheduler: {
        listTasks: async () => [],
      },
      goalController: {
        getGoalStatus: async () => null,
      },
      writeLine: () => {},
      writeError: () => {},
    });
    const line = formatStatusLine(snapshot);

    assert.equal(snapshot.costPer1kTokens, 0.002);
    assert.match(line, /上下文=12,000\/120,000\(10%\)/);
    assert.match(line, /成本≈\$0\.0240/);
  } finally {
    if (previous === undefined) delete process.env.QLING_STATUSLINE_COST_PER_1K_TOKENS;
    else process.env.QLING_STATUSLINE_COST_PER_1K_TOKENS = previous;
  }
});

test("statusline short session id keeps compact prompt width", () => {
  assert.equal(resolveShortSessionId(""), "-");
  assert.equal(resolveShortSessionId("abc123"), "abc123");
  assert.equal(resolveShortSessionId("session_1234567890abcdef"), "session_1234");
});

test("statusline permission mode formatter explains local tool behavior", () => {
  assert.equal(formatPermissionMode("allow"), "允许(自动)");
  assert.equal(formatPermissionMode("ask"), "询问(确认)");
  assert.equal(formatPermissionMode("deny"), "拒绝");
  assert.equal(formatPermissionMode(null), "-(未知)");
  assert.equal(formatPermissionMode("custom"), "-(未知)");
});

test("local statusline snapshot uses config model, permission mode, and git branch", () => {
  const root = mkdtempSync(join(tmpdir(), "qling-statusline-"));
  try {
    mkdirSync(join(root, ".git"), { recursive: true });
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");

    const snapshot = collectLocalStatusLineSnapshot({
      workspaceDir: root,
      model: "local-status-model",
      permissionMode: "ask",
      maxTokens: 120000,
      costPer1kTokens: 0.002,
    });
    const line = formatStatusLine(snapshot);

    assert.equal(snapshot.branch, "main");
    assert.match(line, /模型=local-status-model/);
    assert.match(line, /会话=-/);
    assert.match(line, /分支=main/);
    assert.match(line, /权限=询问\(确认\)/);
    assert.match(line, /目标=无/);
    assert.match(line, /任务=0/);
    assert.match(line, /令牌=0/);
    assert.match(line, /上下文=0\/120,000\(0%\)/);
    assert.match(line, /成本≈\$0\.0000/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
