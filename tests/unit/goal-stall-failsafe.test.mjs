import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { goalCommand } from "../../dist/commands/goal.js";
import { GoalEvaluator } from "../../dist/session/goal-evaluator.js";
import {
  GOAL_PREMATURE_STOP_EVENT,
  SessionGoalController,
  gapFingerprint,
} from "../../dist/session/goal-controller.js";
import { detectPrematureStop } from "../../dist/session/premature-stop.js";
import { GOAL_HISTORY_MAX, SessionGoalManager } from "../../dist/session/session-goal-manager.js";

async function withState(prefix, fn) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(stateDir);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

function goalPath(stateDir, sessionId) {
  return path.join(stateDir, "session-goals", `${sessionId}.json`);
}

async function controllerFor(stateDir, sessionId, evaluator, options = {}) {
  const manager = new SessionGoalManager({ stateDir, sessionId, clock: () => 1_000 });
  const controller = new SessionGoalController({
    manager,
    runner: "session",
    maxAutoTurns: options.maxAutoTurns ?? 12,
    stallThreshold: options.stallThreshold ?? 2,
    evidenceGoals: options.evidenceGoals ?? false,
    evaluator: { evaluate: evaluator },
  });
  await controller.init();
  return { manager, controller };
}

test("gap fingerprint ignores digits, path line numbers, and whitespace", () => {
  assert.equal(gapFingerprint("missing src/app.ts:12 item 3").length, 12);
  assert.equal(
    gapFingerprint("Missing src/app.ts:12 item 3"),
    gapFingerprint("missing   src/app.ts:99 item 8"),
  );
  assert.notEqual(
    gapFingerprint("missing src/app.ts:12"),
    gapFingerprint("missing src/b.ts:12"),
  );
});

test("identical evaluator reasons pause as paused_no_progress and stop driving", async () => {
  await withState("qling-goal-stall-", async (stateDir) => {
    let calls = 0;
    const { manager, controller } = await controllerFor(stateDir, "stall", async () => {
      calls += 1;
      return { done: false, reason: "仍未看到测试通过证据" };
    });
    await controller.setGoal("所有测试通过", { turnCount: 0, tokens: 0 });

    const first = await controller.afterTurn({
      transcript: "assistant: 还在修",
      stats: { turnCount: 1, tokens: 10 },
    });
    assert.equal(first.status, "continue");
    assert.equal((await manager.getGoalStatus()).status, "active");

    const second = await controller.afterTurn({
      transcript: "assistant: 还在修",
      stats: { turnCount: 2, tokens: 20 },
    });
    assert.equal(second.status, "paused");
    assert.equal(second.continuePrompt, null);
    const paused = await manager.getGoalStatus();
    assert.equal(paused.status, "paused_no_progress");
    assert.equal(paused.condition, "所有测试通过");
    assert.equal(paused.history.length, 2);
    assert.equal(paused.history[0].fingerprint, paused.history[1].fingerprint);
    assert.equal(manager.getActiveGoal(), null);

    const third = await controller.afterTurn({
      transcript: "assistant: 还在修",
      stats: { turnCount: 3, tokens: 30 },
    });
    assert.equal(third.status, "idle");
    assert.equal(calls, 2);
  });
});

test("line-number-only reason changes still count as the same stall", async () => {
  await withState("qling-goal-stall-norm-", async (stateDir) => {
    const reasons = [
      "缺少 src/app.ts:12 的证据 3",
      "缺少 src/app.ts:99 的证据 8",
    ];
    const { manager, controller } = await controllerFor(stateDir, "stall-norm", async () => ({
      done: false,
      reason: reasons.shift(),
    }));
    await controller.setGoal("修掉报错", { turnCount: 0, tokens: 0 });
    const first = await controller.afterTurn({ transcript: "assistant: 看日志", stats: { turnCount: 1, tokens: 1 } });
    assert.equal(first.status, "continue");
    const second = await controller.afterTurn({ transcript: "assistant: 还是那一行", stats: { turnCount: 2, tokens: 2 } });
    assert.equal(second.status, "paused");
    assert.equal((await manager.getGoalStatus()).status, "paused_no_progress");
  });
});

test("distinct gaps do not stall", async () => {
  await withState("qling-goal-stall-distinct-", async (stateDir) => {
    const reasons = ["缺少测试", "缺少构建"];
    const { manager, controller } = await controllerFor(stateDir, "stall-distinct", async () => ({
      done: false,
      reason: reasons.shift(),
    }));
    await controller.setGoal("测试和构建都通过", { turnCount: 0, tokens: 0 });
    const first = await controller.afterTurn({ transcript: "assistant: a", stats: { turnCount: 1, tokens: 1 } });
    const second = await controller.afterTurn({ transcript: "assistant: b", stats: { turnCount: 2, tokens: 2 } });
    assert.equal(first.status, "continue");
    assert.equal(second.status, "continue");
    assert.equal((await manager.getGoalStatus()).status, "active");
  });
});

test("auto-turn cap pauses as paused_budget, keeps the goal, and resume reactivates it", async () => {
  await withState("qling-goal-budget-", async (stateDir) => {
    const { manager, controller } = await controllerFor(
      stateDir,
      "budget",
      async () => ({ done: false, reason: "还没好" }),
      { maxAutoTurns: 1 },
    );
    await controller.setGoal("完成 lint", { turnCount: 5, tokens: 50 });
    const paused = await controller.afterTurn({
      transcript: "assistant: 继续",
      stats: { turnCount: 7, tokens: 80 },
    });
    assert.equal(paused.status, "paused");
    assert.match(paused.reason, /max auto turns/i);
    const stored = await manager.getGoalStatus();
    assert.equal(stored.status, "paused_budget");
    assert.equal(stored.condition, "完成 lint");
    assert.equal(stored.baselineTurns, 7);

    const resumed = await controller.resumeGoal();
    assert.equal(resumed.status, "active");
    assert.equal(manager.getActiveGoal("session")?.status, "active");
    const continued = await controller.afterTurn({
      transcript: "assistant: 换个办法",
      stats: { turnCount: 8, tokens: 90 },
    });
    assert.equal(continued.status, "continue");
  });
});

test("QLING_FEATURES_EVIDENCE_GOALS still blocks at the auto-turn cap", async () => {
  await withState("qling-goal-evidence-cap-", async (stateDir) => {
    const previous = process.env.QLING_FEATURES_EVIDENCE_GOALS;
    process.env.QLING_FEATURES_EVIDENCE_GOALS = "true";
    try {
      const manager = new SessionGoalManager({ stateDir, sessionId: "evidence-cap", clock: () => 1_000 });
      const controller = new SessionGoalController({
        manager,
        maxAutoTurns: 1,
        stallThreshold: 2,
        evaluator: { evaluate: async () => ({ done: false, reason: "未完成" }) },
      });
      await controller.init();
      await controller.setGoal("证据目标", { turnCount: 0, tokens: 0 });
      const result = await controller.afterTurn({
        transcript: "assistant: 继续",
        stats: { turnCount: 2, tokens: 10 },
      });
      assert.equal(result.status, "blocked");
      assert.equal((await manager.getGoalStatus()).status, "blocked");
    } finally {
      if (previous === undefined) delete process.env.QLING_FEATURES_EVIDENCE_GOALS;
      else process.env.QLING_FEATURES_EVIDENCE_GOALS = previous;
    }
  });
});

test("two evaluator throws pause as paused_infra and the first throw does not continue", async () => {
  await withState("qling-goal-infra-throw-", async (stateDir) => {
    const { manager, controller } = await controllerFor(stateDir, "infra-throw", async () => {
      throw new Error("injected evaluator failure");
    });
    await controller.setGoal("永远达不到", { turnCount: 0, tokens: 0 });
    const first = await controller.afterTurn({
      transcript: "assistant: 试一次",
      stats: { turnCount: 1, tokens: 10 },
    });
    assert.equal(first.status, "evaluator_error");
    assert.equal(first.continuePrompt, null);
    assert.equal((await manager.getGoalStatus()).status, "active");

    const second = await controller.afterTurn({
      transcript: "assistant: 再试一次",
      stats: { turnCount: 2, tokens: 20 },
    });
    assert.equal(second.status, "paused");
    assert.match(second.reason, /injected evaluator failure/);
    const paused = await manager.getGoalStatus();
    assert.equal(paused.status, "paused_infra");
    assert.equal(paused.condition, "永远达不到");
    assert.equal(manager.getActiveGoal(), null);
  });
});

test("missing evaluator key and unparseable results are infra failures, not progress", async () => {
  await withState("qling-goal-infra-key-", async (stateDir) => {
    const { manager, controller } = await controllerFor(stateDir, "infra-key", async () => ({
      done: false,
      reason: "goal evaluator 缺少 API key，无法确认条件达成",
      error: "no_key",
    }));
    await controller.setGoal("需要 key 的目标", { turnCount: 0, tokens: 0 });
    assert.equal((await controller.afterTurn({
      transcript: "assistant: 1",
      stats: { turnCount: 1, tokens: 1 },
    })).status, "evaluator_error");
    const second = await controller.afterTurn({
      transcript: "assistant: 2",
      stats: { turnCount: 2, tokens: 2 },
    });
    assert.equal(second.status, "paused");
    assert.equal((await manager.getGoalStatus()).status, "paused_infra");
  });
});

test("corrupt or unknown goal snapshots never load as active", async () => {
  await withState("qling-goal-corrupt-", async (stateDir) => {
    const sessionId = "corrupt";
    const file = goalPath(stateDir, sessionId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{not json", "utf8");
    const broken = new SessionGoalManager({ stateDir, sessionId, clock: () => 1_000 });
    await broken.init();
    const brokenStatus = await broken.getGoalStatus();
    assert.equal(brokenStatus.status, "paused_infra");
    assert.notEqual(brokenStatus.status, "active");
    assert.equal(broken.getActiveGoal(), null);

    const unknownFile = goalPath(stateDir, "unknown");
    await fs.writeFile(unknownFile, JSON.stringify({
      status: "flying",
      condition: "不应该自己跑起来",
      runner: "session",
      pending: true,
    }), "utf8");
    const unknown = new SessionGoalManager({ stateDir, sessionId: "unknown", clock: () => 1_000 });
    await unknown.init();
    const unknownStatus = await unknown.getGoalStatus();
    assert.equal(unknownStatus.status, "paused_infra");
    assert.equal(unknownStatus.condition, "不应该自己跑起来");
    assert.equal(unknown.getActiveGoal(), null);
    const rewritten = JSON.parse(await fs.readFile(unknownFile, "utf8"));
    assert.equal(rewritten.status, "paused_infra");

    const pausedFile = goalPath(stateDir, "stays-paused");
    await fs.writeFile(pausedFile, JSON.stringify({
      status: "paused_budget",
      condition: "等用户恢复",
      runner: "daemon",
      pending: true,
      baselineTurns: 3,
      baselineTokens: 4,
      evaluatedTurns: 1,
      lastReason: "cap",
      lastDecision: "paused",
    }), "utf8");
    const paused = new SessionGoalManager({ stateDir, sessionId: "stays-paused", clock: () => 1_000 });
    await paused.init();
    assert.equal((await paused.getGoalStatus()).status, "paused_budget");
    assert.equal(paused.getActiveGoal("daemon"), null);

    const activeFile = goalPath(stateDir, "still-active");
    await fs.writeFile(activeFile, JSON.stringify({
      status: "active",
      condition: "保持 active",
      runner: "session",
      pending: false,
      baselineTurns: 0,
      baselineTokens: 0,
      evaluatedTurns: 0,
      lastReason: null,
      lastDecision: null,
    }), "utf8");
    const active = new SessionGoalManager({ stateDir, sessionId: "still-active", clock: () => 1_000 });
    await active.init();
    assert.equal(active.getActiveGoal()?.condition, "保持 active");
  });
});

test("unreadable primary falls back to .bak and a valid active backup can load", async () => {
  await withState("qling-goal-bak-", async (stateDir) => {
    const sessionId = "from-bak";
    const file = goalPath(stateDir, sessionId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.bak`, JSON.stringify({
      status: "active",
      condition: "来自备份",
      runner: "session",
      pending: false,
      baselineTurns: 1,
      baselineTokens: 2,
      evaluatedTurns: 0,
      lastReason: "backup",
      lastDecision: null,
    }), "utf8");
    await fs.writeFile(file, "{broken primary", "utf8");
    const manager = new SessionGoalManager({ stateDir, sessionId, clock: () => 1_000 });
    await manager.init();
    const status = await manager.getGoalStatus();
    assert.equal(status.status, "active");
    assert.equal(status.condition, "来自备份");
    const repaired = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(repaired.condition, "来自备份");
    assert.equal(repaired.status, "active");
  });
});

test("saveGoal writes atomically and keeps a .bak after the second save", async () => {
  await withState("qling-goal-atomic-", async (stateDir) => {
    const manager = new SessionGoalManager({ stateDir, sessionId: "atomic", clock: () => 1_000 });
    await manager.init();
    await manager.setGoal("原子写入", { turnCount: 0, tokens: 0 });
    await manager.markEvaluation({
      done: false,
      reason: "第一次评估",
      turnCount: 1,
      tokens: 1,
      fingerprint: "abc123abc123",
      stallStreak: 1,
    });
    const file = goalPath(stateDir, "atomic");
    const backup = JSON.parse(await fs.readFile(`${file}.bak`, "utf8"));
    assert.equal(backup.lastReason, "goal_activated");
    const primary = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(primary.lastReason, "第一次评估");
    assert.equal(primary.history.length, 1);
  });
});

test("goal history keeps at most 64 entries", async () => {
  await withState("qling-goal-history-", async (stateDir) => {
    const manager = new SessionGoalManager({ stateDir, sessionId: "history", clock: () => 1_000 });
    await manager.init();
    await manager.setGoal("历史上限", { turnCount: 0, tokens: 0 });
    for (let index = 0; index < GOAL_HISTORY_MAX + 1; index += 1) {
      await manager.markEvaluation({
        done: false,
        reason: `reason ${index}`,
        turnCount: index + 1,
        tokens: 0,
        fingerprint: index % 2 === 0 ? "aaaaaaaaaaaa" : "bbbbbbbbbbbb",
        stallStreak: 1,
      });
    }
    const status = await manager.getGoalStatus();
    assert.equal(status.history.length, GOAL_HISTORY_MAX);
    assert.equal(status.history[0].reason, "reason 1");
    assert.equal(status.history.at(-1).reason, `reason ${GOAL_HISTORY_MAX}`);
    assert.equal(status.status, "active");
  });
});

test("only paused goals resume, and /goal resume arms a fresh prompt", async () => {
  await withState("qling-goal-resume-cmd-", async (stateDir) => {
    const { manager, controller } = await controllerFor(stateDir, "resume-cmd", async () => {
      throw new Error("evaluator down");
    });
    await controller.setGoal("恢复我", { turnCount: 0, tokens: 0 });
    await assert.rejects(() => controller.resumeGoal(), /cannot be resumed/);
    await controller.afterTurn({ transcript: "assistant: 1", stats: { turnCount: 1, tokens: 1 } });
    await controller.afterTurn({ transcript: "assistant: 2", stats: { turnCount: 2, tokens: 2 } });
    assert.equal((await manager.getGoalStatus()).status, "paused_infra");

    const lines = [];
    let immediate = null;
    const handled = await goalCommand.execute(["resume"], {
      goalController: controller,
      writeLine: (line = "") => lines.push(line),
      writeError: (line = "") => lines.push(line),
      setImmediatePrompt: (prompt) => {
        immediate = prompt;
      },
    });
    assert.equal(handled, undefined);
    assert.match(lines.join("\n"), /\/goal resume/);
    assert.match(immediate, /恢复我/);
    assert.equal((await controller.getGoalStatus()).status, "active");

    await controller.clearGoal("user_clear");
    const errors = [];
    await goalCommand.execute(["恢复"], {
      goalController: controller,
      writeLine: () => {},
      writeError: (line = "") => errors.push(line),
    });
    assert.match(errors.join("\n"), /无法恢复/);
  });
});

test("premature-stop matches each give-up pattern and ignores confirmation waits", () => {
  const cases = [
    { pattern: "cannot_continue", positive: "我无法继续了，需要你接手。", negative: "我可以继续把剩下的做完。" },
    { pattern: "cannot_complete", positive: "这个任务我无法完成。", negative: "这个任务可以完成。" },
    { pattern: "stop_here", positive: "先到这里，剩下的你来。", negative: "我们从这里开始看实现。" },
    { pattern: "pause_here", positive: "暂停在此，等待下一步指示。", negative: "这里先不要暂停讨论。" },
    { pattern: "please_manual", positive: "请你手动跑一下测试。", negative: "请你看一下 diff。" },
    { pattern: "wait_until_done", positive: "等编译完成后再继续。", negative: "等你确认后" },
    { pattern: "committed", positive: "已提交 commit，请 review。", negative: "还没有提交代码。" },
    { pattern: "unable_to_proceed", positive: "I can't proceed without the password.", negative: "I can proceed with the next step." },
    { pattern: "giving_up", positive: "Giving up. This path is blocked.", negative: "I will keep trying another approach." },
    { pattern: "stopping_here", positive: "Stopping here until you reply.", negative: "Not stopping the search yet." },
  ];

  for (const entry of cases) {
    assert.equal(detectPrematureStop(entry.positive)?.pattern, entry.pattern, entry.pattern);
    assert.equal(detectPrematureStop(entry.negative), null, entry.negative);
  }

  assert.equal(detectPrematureStop("请你自行完成剩余步骤。")?.pattern, "please_manual");
  assert.equal(detectPrematureStop("请你运行 npm test。")?.pattern, "please_manual");
  assert.equal(detectPrematureStop("请你提供缺少的日志。")?.pattern, "please_manual");
  assert.equal(detectPrematureStop("等你把测试跑完后再看结果。")?.pattern, "wait_until_done");
  assert.equal(detectPrematureStop("等你确认后再继续"), null);
  assert.equal(detectPrematureStop("I cannot proceed.").pattern, "unable_to_proceed");
  assert.equal(detectPrematureStop("前一段说我无法继续。\n\n最后一段只是在汇报进度。"), null);
});

test("an active goal replaces a premature give-up with another attempt and emits an event", async () => {
  await withState("qling-goal-premature-", async (stateDir) => {
    const { controller } = await controllerFor(stateDir, "premature", async () => ({
      done: false,
      reason: "还没有证据",
    }), { stallThreshold: 5 });
    await controller.setGoal("把测试跑绿", { turnCount: 0, tokens: 0 });
    const events = [];
    controller.on(GOAL_PREMATURE_STOP_EVENT, (event) => events.push(event));

    const hit = await controller.afterTurn({
      transcript: "user: 继续\n\nassistant: 我无法继续了。",
      stats: { turnCount: 1, tokens: 10 },
    });
    assert.equal(hit.status, "continue");
    assert.match(hit.continuePrompt, /不要交还给用户/);
    assert.match(hit.continuePrompt, /cannot_continue/);
    assert.deepEqual(events, [{ pattern: "cannot_continue", condition: "把测试跑绿" }]);

    const missed = await controller.afterTurn({
      transcript: "assistant: 等你确认后我再改。",
      stats: { turnCount: 2, tokens: 20 },
    });
    assert.equal(missed.status, "continue");
    assert.match(missed.continuePrompt, /请继续推进/);
    assert.doesNotMatch(missed.continuePrompt, /不要交还给用户/);
    assert.equal(events.length, 1);
  });
});

test("goal evaluator reports network, timeout, missing key, and unparseable results without throwing", async () => {
  const missingKey = await new GoalEvaluator({
    provider: "openai",
    apiKey: "",
    fetchImpl: async () => {
      throw new Error("should not fetch");
    },
  }).evaluate({ condition: "x", transcript: "y" });
  assert.equal(missingKey.done, false);
  assert.equal(missingKey.error, "no_key");

  const network = await new GoalEvaluator({
    provider: "openai",
    apiKey: "test-key",
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  }).evaluate({ condition: "x", transcript: "y" });
  assert.equal(network.done, false);
  assert.equal(network.error, "network");

  const httpError = await new GoalEvaluator({
    provider: "openai",
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  }).evaluate({ condition: "x", transcript: "y" });
  assert.equal(httpError.error, "network");
  assert.match(httpError.reason, /503/);

  const unparseable = await new GoalEvaluator({
    provider: "openai",
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "not json" } }] }),
    }),
  }).evaluate({ condition: "x", transcript: "y" });
  assert.equal(unparseable.done, false);
  assert.equal(unparseable.error, "unparseable");

  const parsed = await new GoalEvaluator({
    provider: "openai",
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "{\"done\":false,\"reason\":\"还没好\"}" } }],
      }),
    }),
  }).evaluate({ condition: "x", transcript: "y" });
  assert.equal(parsed.done, false);
  assert.equal(parsed.reason, "还没好");
  assert.equal(parsed.error, undefined);

  const timedOut = await new GoalEvaluator({
    provider: "openai",
    apiKey: "test-key",
    timeoutMs: 20,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      const abort = () => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (init?.signal?.aborted) {
        abort();
        return;
      }
      init?.signal?.addEventListener("abort", abort, { once: true });
    }),
  }).evaluate({ condition: "x", transcript: "y" });
  assert.equal(timedOut.done, false);
  assert.equal(timedOut.error, "timeout");
});
