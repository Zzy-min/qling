import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  assessTaskComplexity,
  analyzeStallAndStrategyShift,
  DecisionLedger,
  detectConflictingConstraints,
  extractPromptConstraints,
} from "../../dist/agent/decision-engine.js";
import {
  createStructuredTaskPlan,
  getReadyPlanSteps,
  loadWorkspaceTaskPlan,
  replanStructuredTaskPlan,
  summarizeTaskPlan,
  updatePlanStepStatus,
  validatePlanDependencies,
} from "../../dist/plan/task-plan.js";
import { runPlanner } from "../../dist/tools/planner.js";
import { loadWorkspaceTodoState, runTodo } from "../../dist/tools/todo.js";
import {
  detectPrematureStop,
  detectPrematureStopDetailed,
  stripLeadingMarkdown,
} from "../../dist/session/premature-stop.js";
import {
  auditClaimsAgainstEvidence,
  evaluatePreFinalSelfCheck,
  evaluateTaskResult,
  ResultEvaluator,
} from "../../dist/session/outcome-evidence.js";
import {
  boundedGoalTranscript,
  GoalEvaluator,
} from "../../dist/session/goal-evaluator.js";
import { MissionManager } from "../../dist/mission/manager.js";
import { buildDashboardTasks } from "../../dist/dashboard/model.js";
import {
  ContextCompactor,
  validateCompactionCandidate,
} from "../../dist/context-compactor.js";
import { upsertSyntheticMessage } from "../../dist/agent/synthetic-messages.js";
import { runInnerIterationLoop } from "../../dist/agent/main-loop.js";
import { ExecutionEventBus } from "../../dist/execution/event-bus.js";
import { RecoveryController } from "../../dist/execution/recovery-controller.js";
import { runReasoningBenchmark } from "../../dist/eval/reasoning-benchmark.js";
import { formatStatusLine } from "../../dist/statusline.js";

describe("Stage 2: Structured Decision Loop & Dynamic Complexity Strategy Routing", () => {
  it("routes simple read-only tasks to fast_path and skips unnecessary planning stages", () => {
    const profile = assessTaskComplexity("查看当前项目的 package.json 版本号");
    assert.equal(profile.strategyTier, "fast_path");
    assert.equal(profile.requiresPreExecutionPlan, false);
    assert.deepEqual(profile.recommendedStages, [
      "understand",
      "act",
      "verify",
      "finish",
    ]);
  });

  it("routes localized code fix tasks to light_plan", () => {
    const profile = assessTaskComplexity("修复 src/utils.ts 中的日期格式化 bug 并添加测试", {
      requireWorkspaceMutation: true,
    });
    assert.equal(profile.strategyTier, "light_plan");
    assert.equal(profile.requiresStrictVerification, true);
    assert.ok(profile.recommendedStages.includes("plan_decide"));
    assert.ok(profile.recommendedStages.includes("verify"));
  });

  it("routes multi-step architectural refactoring to full_plan", () => {
    const profile = assessTaskComplexity(
      "系统性重构 Agent 推理编排、任务规划状态机与结果验证体系：\n1. 重构主循环\n2. 实现 DAG 计划\n3. 建立独立验证器\n4. 完成全套回归测试",
    );
    assert.equal(profile.strategyTier, "full_plan");
    assert.equal(profile.requiresPreExecutionPlan, true);
    assert.equal(profile.requiresStrictVerification, true);
    assert.ok(profile.recommendedStages.includes("update_replan"));
  });

  it("routes destructive or irreversible operations to high_risk regardless of prompt length", () => {
    const profile = assessTaskComplexity("rm -rf /tmp/prod_cache && git push --force");
    assert.equal(profile.strategyTier, "high_risk");
    assert.equal(profile.dimensions.riskLevel, "high");
    assert.equal(profile.dimensions.reversibility, "irreversible");
    assert.equal(profile.requiresApprovalCheck, true);
    assert.equal(profile.requiresStrictVerification, true);
  });

  it("records auditable DecisionRecords in DecisionLedger without exposing raw CoT", () => {
    const ledger = new DecisionLedger({
      goal: "实现并验证配置解析器",
      strategyTier: "light_plan",
      initialConstraints: ["禁止破坏现有导出接口"],
    });
    ledger.recordTurnObservations({
      turn: 1,
      observations: [
        { tool: "read_anchored", failed: false, targetPath: "src/config.ts" },
      ],
    });
    ledger.recordTurnObservations({
      turn: 2,
      observations: [
        {
          tool: "patch_anchored",
          failed: false,
          targetPath: "src/config.ts",
          mutation: "updated",
        },
      ],
    });
    const records = ledger.getRecords();
    assert.equal(records.length, 2);
    assert.equal(records[0].stage, "gather");
    assert.equal(records[1].stage, "act");
    assert.equal(records[1].nextStep, "verify");
    const formatted = ledger.formatDecisionLedgerBlock();
    assert.match(formatted, /<decision_ledger strategy="light_plan" stage="act">/);
    assert.match(formatted, /禁止破坏现有导出接口/);
  });

  it("analyzes stall root causes, recommends alternative tool paths, and triggers safe termination at limit", () => {
    const editStall = analyzeStallAndStrategyShift({
      failedTool: "edit_file",
      failureFingerprint: "edit_file:mismatch",
      consecutiveFailures: 3,
      noProgressTurns: 4,
      hasActivePlan: true,
    });
    assert.equal(editStall.strategyEffective, false);
    assert.deepEqual(editStall.alternativeTools, ["read_anchored", "patch_anchored"]);
    assert.equal(editStall.shouldReplan, true);
    assert.equal(editStall.shouldTerminateSafely, false);
    assert.match(editStall.formattedGuidanceBlock, /<strategy_shift>/);

    const terminalStall = analyzeStallAndStrategyShift({
      failedTool: "bash",
      failureFingerprint: "bash:exit_1",
      consecutiveFailures: 6,
      noProgressTurns: 12,
      maxNoProgressTurns: 12,
    });
    assert.equal(terminalStall.shouldTerminateSafely, true);
    assert.ok(terminalStall.terminationReason);
  });
});

describe("Stage 3: Executable Structured Task Plan, DAG Validation, PlanGuard & Mission State Machine", () => {
  it("validates DAG dependencies and rejects cycles or unknown step IDs", () => {
    const cycleCheck = validatePlanDependencies([
      { id: "a", title: "Step A", dependsOn: ["b"] },
      { id: "b", title: "Step B", dependsOn: ["a"] },
    ]);
    assert.equal(cycleCheck.ok, false);
    assert.match(cycleCheck.error ?? "", /Circular dependency/i);

    const missingCheck = validatePlanDependencies([
      { id: "a", title: "Step A", dependsOn: ["non_existent"] },
    ]);
    assert.equal(missingCheck.ok, false);
    assert.match(missingCheck.error ?? "", /unknown step/i);
  });

  it("tracks ready steps, preserves reported completed steps across replanning, and enforces PlanGuard", () => {
    let plan = createStructuredTaskPlan({
      objective: "重构工具调度层并完成单元测试",
      steps: [
        { id: "s1", title: "审计现有工具层" },
        { id: "s2", title: "修改调度器实现", dependsOn: ["s1"] },
        { id: "s3", title: "运行测试", dependsOn: ["s2"] },
      ],
    });
    assert.deepEqual(
      getReadyPlanSteps(plan).map((s) => s.id),
      ["s1"],
    );

    plan = updatePlanStepStatus(plan, "s1", {
      status: "completed",
      verificationEvidence: "已完成 tool-orchestrator.ts 审计",
    });
    assert.deepEqual(
      getReadyPlanSteps(plan).map((s) => s.id),
      ["s2"],
    );

    // Dynamic replan preserves s1 (completed) and replaces s2/s3
    const replanned = replanStructuredTaskPlan(plan, {
      reason: "需要先拆分接口定义再修改调度器",
      newSteps: [
        { id: "s2_types", title: "提取调度接口类型", dependsOn: ["s1"] },
        { id: "s2_impl", title: "更新调度器实现", dependsOn: ["s2_types"] },
        { id: "s3", title: "运行单元测试", dependsOn: ["s2_impl"] },
      ],
    });
    assert.equal(replanned.replanCount, 1);
    assert.equal(replanned.steps.find((s) => s.id === "s1")?.status, "completed");
    assert.equal(summarizeTaskPlan(replanned).completedSteps, 1);
    assert.equal(summarizeTaskPlan(replanned).totalSteps, 4);

    // PlanGuard blocks silent objective drift unless allowObjectiveOverride=true
    assert.throws(
      () =>
        replanStructuredTaskPlan(replanned, {
          reason: "篡改任务目标",
          objective: "完全不同的新任务目标",
          newSteps: [{ id: "x", title: "无关步骤" }],
        }),
      /PlanGuard violation/i,
    );
  });

  it("persists workspace plans via runPlanner and isolates todos per workspace via runTodo", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-plan-todo-test-"));
    try {
      const createRes = await runPlanner({
        action: "create",
        objective: "端到端重构验证",
        workspaceDir: tmpDir,
        steps: [
          {
            id: "step_1",
            title: "创建核心模块",
            requiredTools: ["write"],
            acceptanceCriteria: "文件存在且编译通过",
          },
          {
            id: "step_2",
            title: "运行验证",
            dependsOn: ["step_1"],
            requiredTools: ["verify"],
          },
        ],
      });
      assert.ok(!createRes.is_error);

      const updateRes = await runPlanner({
        action: "update_step",
        workspaceDir: tmpDir,
        stepId: "step_1",
        status: "completed",
        verificationEvidence: "src/core.ts created",
      });
      assert.ok(!updateRes.is_error);

      const loadedPlan = await loadWorkspaceTaskPlan(tmpDir);
      assert.ok(loadedPlan);
      assert.equal(loadedPlan.steps[0].status, "completed");

      // Grok Build batch todos update
      const todoBatchRes = await runTodo({
        workspaceDir: tmpDir,
        merge: false,
        todos: [
          { id: "t1", content: "编写代码", status: "completed" },
          { id: "t2", content: "运行测试", status: "in_progress", dependsOn: ["t1"] },
        ],
      });
      assert.ok(!todoBatchRes.is_error);

      const todoState = loadWorkspaceTodoState(tmpDir);
      assert.ok(todoState);
      assert.equal(todoState.total, 2);
      assert.equal(todoState.completed, 1);
      assert.equal(todoState.inProgress, 1);

      // Duplicate ID in batch is rejected
      const dupRes = await runTodo({
        workspaceDir: tmpDir,
        todos: [
          { id: "dup", content: "A" },
          { id: "dup", content: "B" },
        ],
      });
      assert.equal(dupRes.is_error, true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("transitions Mission 10-state lifecyclePhase and reflects in DashboardTask", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-mission-test-"));
    try {
      const manager = new MissionManager(tmpDir);
      await manager.init();
      const mission = await manager.createMission({
        name: "重构验证任务",
        description: "测试 10 态状态机流转",
        sessionId: "sess_1",
        initialContext: [],
        strategyTier: "full_plan",
      });
      assert.equal(mission.lifecyclePhase, "pending");
      assert.equal(mission.status, "queued");

      const planning = await manager.transitionLifecyclePhase(mission.id, "planning", {
        planProgress: { completedSteps: 0, totalSteps: 3, replanCount: 0 },
      });
      assert.equal(planning?.lifecyclePhase, "planning");
      assert.equal(planning?.status, "running");

      const partial = await manager.transitionLifecyclePhase(
        mission.id,
        "partially_completed",
        {
          completionStatus: "partially_completed",
          planProgress: { completedSteps: 2, totalSteps: 3, replanCount: 1 },
        },
      );
      assert.equal(partial?.lifecyclePhase, "partially_completed");
      assert.equal(partial?.status, "paused");

      const tasks = buildDashboardTasks({
        missions: [partial],
        loops: [],
        workflow: null,
        daemonHealthy: true,
      });
      assert.equal(tasks[0].lifecyclePhase, "partially_completed");
      assert.equal(tasks[0].completionStatus, "partially_completed");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Stage 4: Independent Result Evaluation, Claim-vs-Evidence Audit & Premature Stop Panel", () => {
  it("strips leading markdown and detects Grok Build 9-category premature stops", () => {
    assert.equal(stripLeadingMarkdown("## **Verdict: Ready"), "Verdict: Ready");

    const giveUp = detectPrematureStopDetailed("I am giving up on this task.");
    assert.ok(giveUp);
    assert.equal(giveUp.category, "giving_up");

    const agentsInFlight = detectPrematureStopDetailed(
      "Waiting for the subagents to finish.",
    );
    assert.ok(agentsInFlight);
    assert.equal(agentsInFlight.category, "agents_in_flight");

    const checkBack = detectPrematureStopDetailed(
      "I will check back in 5 minutes once the build finishes.",
    );
    assert.ok(checkBack);
    assert.equal(checkBack.category, "check_back_later");

    // User-directed pronoun should NOT trigger check_back_later
    const userCheckBack = detectPrematureStopDetailed(
      "Feel free to check back later if you need anything else.",
    );
    assert.equal(userCheckBack, null);

    // Preserves legacy Qling premature stop patterns
    const legacy = detectPrematureStop("我已经完成了第一阶段，请你自行运行测试。");
    assert.ok(legacy);
    assert.equal(legacy.pattern, "please_manual");
  });

  it("audits model prose claims against actual tool execution evidence and filesystem state", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-audit-test-"));
    try {
      // Case 1: Model claims it created a file and passed tests with ZERO tool calls
      const findings1 = auditClaimsAgainstEvidence({
        userPrompt: "请创建文件 output.json 并运行测试",
        finalText: "我已成功创建文件 output.json，并且已运行全部测试通过。",
        workspaceDir: tmpDir,
        toolExecutions: [],
      });
      assert.ok(
        findings1.some((f) => f.kind === "unbacked_file_mutation_claim"),
      );
      assert.ok(
        findings1.some((f) => f.kind === "unbacked_verification_claim"),
      );

      // Case 2: Write tool was called, but file on disk is empty (0 bytes)
      const emptyFile = path.join(tmpDir, "empty.txt");
      await fs.writeFile(emptyFile, "", "utf8");
      const findings2 = auditClaimsAgainstEvidence({
        userPrompt: "创建 empty.txt",
        finalText: "已创建文件 empty.txt",
        workspaceDir: tmpDir,
        toolExecutions: [
          { tool: "write", failed: false, targetPath: "empty.txt", mutation: "created" },
        ],
      });
      assert.ok(
        findings2.some((f) => f.kind === "empty_target_file_on_disk"),
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("distinguishes all 6 TaskCompletionStatus states accurately via ResultEvaluator", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-evaluator-test-"));
    try {
      const evaluator = new ResultEvaluator();
      const validFile = path.join(tmpDir, "feature.ts");
      await fs.writeFile(validFile, "export const v = 42;\n", "utf8");

      // 1. completed_verified
      const r1 = evaluator.evaluate({
        userPrompt: "实现 feature.ts 并运行测试",
        finalText: "已完成 feature.ts 实现并通过验证。",
        workspaceDir: tmpDir,
        toolExecutions: [
          { tool: "write", failed: false, targetPath: "feature.ts", mutation: "created" },
          { tool: "verify", failed: false, isVerification: true, verificationVerdict: "pass", command: "node --test", exitCode: 0 },
        ],
        latestVerificationVerdict: "pass",
      });
      assert.equal(r1.completionStatus, "completed_verified");
      assert.equal(r1.allowFinish, true);

      // 2. completed_unverified (code modified, exists on disk, but no verification ran and requireDeterministicVerification=false)
      const r2 = evaluator.evaluate({
        userPrompt: "重构 feature.ts 中的 TypeScript 实现",
        finalText: "已修改 feature.ts，尚未运行测试。",
        workspaceDir: tmpDir,
        toolExecutions: [
          { tool: "patch_anchored", failed: false, targetPath: "feature.ts", mutation: "updated" },
        ],
        requireDeterministicVerification: false,
      });
      assert.equal(r2.completionStatus, "completed_unverified");

      // 3. partially_completed (plan partially done and honestly reported)
      let plan = createStructuredTaskPlan({
        objective: "分两步完成改造",
        steps: [
          { id: "s1", title: "第一步" },
          { id: "s2", title: "第二步", dependsOn: ["s1"] },
        ],
      });
      plan = updatePlanStepStatus(plan, "s1", { status: "completed" });
      const r3 = evaluator.evaluate({
        userPrompt: plan.objective,
        finalText: "部分完成：已完成 s1，剩余 s2 待外部服务恢复后继续。",
        workspaceDir: tmpDir,
        toolExecutions: [
          { tool: "write", failed: false, targetPath: "feature.ts", mutation: "updated" },
          { tool: "verify", failed: false, isVerification: true, verificationVerdict: "pass" },
        ],
        activePlan: plan,
        latestVerificationVerdict: "pass",
      });
      assert.equal(r3.completionStatus, "partially_completed");

      // 4. incomplete (false claim or unfinished plan without honest partial report)
      const r4 = evaluator.evaluate({
        userPrompt: "请创建文件 missing.ts",
        finalText: "我已成功创建文件 missing.ts。",
        workspaceDir: tmpDir,
        toolExecutions: [],
      });
      assert.equal(r4.completionStatus, "incomplete");
      assert.equal(r4.allowFinish, false);
      assert.match(r4.remediationPrompt ?? "", /<verification_audit\b/);

      // 5. failed (all tool calls failed and verification failed)
      const r5 = evaluator.evaluate({
        userPrompt: "修复构建错误",
        finalText: "执行失败：构建仍然报错。",
        workspaceDir: tmpDir,
        toolExecutions: [
          { tool: "bash", failed: true },
          { tool: "verify", failed: true, isVerification: true, verificationVerdict: "fail" },
        ],
        latestVerificationVerdict: "fail",
      });
      assert.equal(r5.completionStatus, "failed");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("supports Grok Build 3-way GoalEvaluator schema and untrusted [agent_message] transcript bounding", async () => {
    const transcript = boundedGoalTranscript([
      { role: "user", content: "Fix all lint errors" },
      { role: "assistant", content: "I fixed everything!" },
    ]);
    assert.match(transcript, /\[agent_message\].*untrusted.*I fixed everything!/);

    const evaluator = new GoalEvaluator({
      provider: "openai",
      endpoint: "http://localhost:11434/v1/chat/completions",
      apiKey: "test-key",
      model: "mock-model",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: "blocked",
                  reason: "Missing database credentials",
                  blocker_key: "missing_env:DB_PASSWORD",
                  next_step: "Ask user for DB_PASSWORD",
                }),
              },
            },
          ],
        }),
      }),
    });
    const res = await evaluator.evaluate({
      condition: "Run migration",
      transcript,
    });
    assert.equal(res.done, false);
    assert.equal(res.decision, "blocked");
    assert.equal(res.blockerKey, "missing_env_db_password");
  });
});

describe("Stage 5 & 7: Context Compaction Retention, Main-Loop Self-Check Interception & 12-Scenario Benchmark", () => {
  it("preserves plan_state and decision_ledger synthetic messages across context compaction", async () => {
    const compactor = new ContextCompactor(300, "gpt-4o");
    const messages = [{ role: "user", content: "重构整个项目" }];
    upsertSyntheticMessage(
      messages,
      "plan_state",
      "<plan_state>step_1: completed</plan_state>",
      "plan-v1",
    );
    upsertSyntheticMessage(
      messages,
      "decision_ledger",
      "<decision_ledger>stage=act</decision_ledger>",
      "ledger-v1",
    );
    for (let i = 0; i < 10; i++) {
      messages.push({ role: "assistant", content: "中间长输出 ".repeat(40) });
      messages.push({ role: "user", content: `继续第 ${i} 轮` });
    }
    const result = await compactor.compactDetailed(messages, 2);
    assert.equal(result.status, "compacted");
    assert.ok(result.messages.some((m) => m.synthetic_reason === "plan_state"));
    assert.ok(result.messages.some((m) => m.synthetic_reason === "decision_ledger"));
  });

  it("intercepts false completion claim in runInnerIterationLoop, injects <verification_audit>, and completes after real tool execution", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-mainloop-selfcheck-"));
    try {
      const targetFile = path.join(tmpDir, "hello.txt");
      const messages = [
        { role: "user", content: "请创建文件 hello.txt 并写入 Hello Qling" },
      ];
      let chatTurn = 0;
      const nudges = [];

      const outcome = await runInnerIterationLoop({
        messages,
        turnCount: 0,
        sessionId: "sess_selfcheck",
        maxIterations: 5,
        toolRepeatLimit: 4,
        parseRetries: 0,
        verificationCommand: null,
        counters: {
          sessionTokens: 0,
          sessionPromptTokens: 0,
          sessionCompletionTokens: 0,
          tokenUsageSource: "unknown",
        },
        compactionCount: 0,
        toolCallTotal: 0,
        toolFailureTotal: 0,
        retryCountTotal: 0,
        loggingFormat: "json",
        compactor: new ContextCompactor(8000, "gpt-4o"),
        pipeline: {
          execute: async (call) => {
            if (call.name === "write") {
              await fs.writeFile(targetFile, String(call.arguments.content ?? ""), "utf8");
              return {
                tool_call_id: call.id,
                output: "已写入 hello.txt",
                is_error: false,
              };
            }
            return { tool_call_id: call.id, output: "ok", is_error: false };
          },
        },
        tools: [
          {
            name: "write",
            description: "Write file",
            parameters: { type: "object", properties: {} },
          },
        ],
        guardConfig: { mode: "allow" },
        channel: null,
        approvalGate: {},
        knowledgeAdapter: {
          onAssistantMessage: () => {},
          onToolCall: () => {},
          onToolResult: () => {},
          onTurnEnd: async () => {},
        },
        memoryStore: {
          addPractice: () => {},
          addConversationTurn: () => {},
          link: () => {},
        },
        workspaceDir: tmpDir,
        fileStateDir: tmpDir,
        workflowRuntime: { updateContext: async () => {} },
        executionEventBus: new ExecutionEventBus(),
        recoveryController: new RecoveryController(),
        verifier: {},
        buildSystemPrompt: async () => "You are Qling.",
        chat: async () => {
          chatTurn++;
          if (chatTurn === 1) {
            // Turn 1: Model halluncinates completion without calling write tool!
            return {
              content: "我已成功创建文件 hello.txt 并写入了 Hello Qling。",
              tool_calls: undefined,
            };
          }
          if (chatTurn === 2) {
            // Turn 2: After receiving <verification_audit>, model calls write tool
            return {
              content: "正在调用 write 工具创建文件",
              tool_calls: [
                {
                  id: "call_write_1",
                  type: "function",
                  function: {
                    name: "write",
                    arguments: JSON.stringify({
                      path: "hello.txt",
                      content: "Hello Qling\n",
                    }),
                  },
                },
              ],
            };
          }
          // Turn 3: Final response backed by real file on disk
          return {
            content: "已创建文件 hello.txt 并验证文件非空。",
            tool_calls: undefined,
          };
        },
        emit: (event, payload) => {
          if (event === "result_evaluation_nudge") nudges.push(payload);
        },
        runVerificationCommand: async () => ({ code: 0, stdout: "ok", stderr: "" }),
        getRecoveryState: () => null,
        reflectiveThink: async () => ({ decision: "proceed", reason: "ok" }),
        checkAutoDream: async () => {},
      });

      assert.equal(outcome.status, "succeeded");
      assert.equal(nudges.length, 1);
      assert.equal(chatTurn, 3);
      assert.equal(outcome.completionStatus, "completed_verified");
      assert.ok(Array.isArray(outcome.decisionLedger));
      assert.ok(outcome.decisionLedger.length >= 3);
      const diskContent = await fs.readFile(targetFile, "utf8");
      assert.equal(diskContent, "Hello Qling\n");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("passes 12 offline contracts without claiming measured real-agent or baseline performance", async () => {
    const summary = await runReasoningBenchmark();
    assert.equal(summary.scenarioCount, 12);
    assert.equal(summary.observedAcceptance, true);
    assert.equal(summary.refactoredMetrics.componentAcceptanceRate, 1);
    assert.equal(summary.refactoredMetrics.observedRuntimeFalseCompletionRate, 0);
    assert.equal(summary.refactoredMetrics.componentContextRetentionRate, 1);
    assert.equal(summary.refactoredMetrics.realAgentTaskSuccessRate, null);
    assert.equal(summary.baselineMetrics, null);
    assert.equal(summary.deltas, null);
  });

  it("handles conflicting prompt constraints, bash-backed missing file claims, and statusline observability fields", async () => {
    const constraints = extractPromptConstraints(
      "请重构日志模块。禁止修改任何文件！同时请直接修改文件 logger.ts 并推送到远程。",
    );
    assert.ok(constraints.length >= 1);
    const conflicts = detectConflictingConstraints(
      "禁止修改任何文件，同时请直接修改文件 logger.ts。",
    );
    assert.equal(conflicts.length, 1);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-edge-audit-"));
    try {
      // Even when bash ran, claiming a specific file was created when it is absent on disk is caught
      const findings = auditClaimsAgainstEvidence({
        userPrompt: "请创建文件 dist-report.json",
        finalText: "我已成功创建文件 dist-report.json。",
        workspaceDir: tmpDir,
        toolExecutions: [{ tool: "bash", failed: false }],
      });
      assert.ok(findings.some((f) => f.kind === "missing_target_file_on_disk"));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }

    const line = formatStatusLine({
      model: "gpt-4o",
      sessionId: "sess_123456",
      branch: "main",
      permissionMode: "allow",
      goalStatus: "active",
      activeTasks: 1,
      tokens: 1200,
      strategyTier: "full_plan",
      completionStatus: "completed_verified",
    });
    assert.match(line, /策略=full_plan/);
    assert.match(line, /判定=completed_verified/);
  });

  it("deduplicates ./ and Windows backslash paths, validates JSON format on disk, and rejects dropped plan_state in validateCompactionCandidate", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-audit-paths-json-"));
    try {
      // 1. Relative ./ and Windows \ paths pointing to same missing file produce only 1 finding
      const dupFindings = auditClaimsAgainstEvidence({
        userPrompt: "请创建文件 ./sub/config.json",
        finalText: "我已创建文件 sub\\config.json。",
        workspaceDir: tmpDir,
        toolExecutions: [
          { tool: "write", failed: false, targetPath: "./sub/config.json", mutation: "created" },
        ],
      });
      const missingCount = dupFindings.filter((f) => f.kind === "missing_target_file_on_disk").length;
      assert.equal(missingCount, 1);

      // 2. Invalid JSON on disk is flagged as invalid_file_format_on_disk and blocks evaluatePreFinalSelfCheck
      const subDir = path.join(tmpDir, "sub");
      await fs.mkdir(subDir, { recursive: true });
      await fs.writeFile(path.join(subDir, "config.json"), "{ invalid json", "utf8");
      const selfCheck = evaluatePreFinalSelfCheck({
        userPrompt: "请创建文件 ./sub/config.json",
        finalText: "我已成功创建文件 sub\\config.json。",
        workspaceDir: tmpDir,
        toolExecutions: [
          { tool: "write", failed: false, targetPath: "./sub/config.json", mutation: "created" },
        ],
      });
      assert.equal(selfCheck.completionStatus, "incomplete");
      assert.equal(selfCheck.allowFinish, false);
      assert.ok(selfCheck.claimAuditFindings.some((f) => f.kind === "invalid_file_format_on_disk"));

      // 3. Planner verify/status actions and __qling_workspace_dir forwarding + replan unknown dependency rejection
      const planCreate = await runPlanner({
        action: "create",
        goal: "多步骤配置生成",
        __qling_workspace_dir: tmpDir,
        steps: [
          { id: "s1", title: "生成配置" },
          { id: "s2", title: "校验配置", dependsOn: ["s1"] },
        ],
      });
      assert.ok(!planCreate.is_error);

      const planVerify = await runPlanner({
        action: "verify",
        stepId: "s1",
        verificationEvidence: "config written",
        __qling_workspace_dir: tmpDir,
      });
      assert.ok(!planVerify.is_error);
      assert.match(planVerify.output, /已记录计划步骤报告 \[s1\].*unverified/);

      const loadedPlan = await loadWorkspaceTaskPlan(tmpDir);
      assert.throws(
        () =>
          replanStructuredTaskPlan(loadedPlan, {
            reason: "测试未知依赖拦截",
            newSteps: [{ id: "s2", title: "新步骤", dependsOn: ["non_existent_dep"] }],
          }),
        /unknown step/i,
      );

      // 4. Todo batch unmet dependency rejection
      const batchUnmet = await runTodo({
        __qling_workspace_dir: tmpDir,
        merge: false,
        todos: [
          { id: "t1", title: "前置步骤", status: "pending" },
          { id: "t2", title: "后置步骤", status: "completed", dependsOn: ["t1"] },
        ],
      });
      assert.equal(batchUnmet.is_error, true);
      assert.equal(batchUnmet.error?.code, "TODO_DEPENDENCY_UNMET");

      // 5. validateCompactionCandidate rejects candidate that drops active plan_state or decision_ledger
      const originalMsgs = [
        { role: "user", content: "执行复杂重构任务" },
        {
          role: "user",
          content: "<plan_state>active</plan_state>",
          synthetic_reason: "plan_state",
          synthetic_key: "plan-v1",
        },
        {
          role: "user",
          content: "<decision_ledger>active</decision_ledger>",
          synthetic_reason: "decision_ledger",
          synthetic_key: "ledger-v1",
        },
      ];
      const droppedPlanCandidate = [
        { role: "user", content: "执行复杂重构任务" },
        {
          role: "user",
          content: "<decision_ledger>active</decision_ledger>",
          synthetic_reason: "decision_ledger",
          synthetic_key: "ledger-v1",
        },
      ];
      const validation = validateCompactionCandidate(originalMsgs, droppedPlanCandidate);
      assert.equal(validation.ok, false);
      assert.match(validation.reason ?? "", /plan_state/i);

      // 6. Extreme token pressure compaction (< 250 maxTokens) concurrent with mid-run replanning
      const tightCompactor = new ContextCompactor(150, "gpt-4o");
      const replanned = replanStructuredTaskPlan(loadedPlan, {
        reason: "中途调整方案",
        newSteps: [{ id: "s2_new", title: "修复 JSON 并完成校验", dependsOn: ["s1"] }],
      });
      upsertSyntheticMessage(
        originalMsgs,
        "plan_state",
        `<plan_state>${replanned.planId}: replan=${replanned.replanCount}</plan_state>`,
        "plan-v1",
      );
      for (let i = 0; i < 6; i++) {
        originalMsgs.push({ role: "assistant", content: `步骤输出 ${i} `.repeat(25) });
        originalMsgs.push({ role: "user", content: `继续执行 ${i}` });
      }
      const tightResult = await tightCompactor.compactDetailed(originalMsgs, 2);
      assert.equal(tightResult.status, "compacted");
      assert.ok(
        tightResult.messages.some(
          (m) => m.synthetic_reason === "plan_state" && m.content.includes("replan=1"),
        ),
      );
      assert.ok(tightResult.messages.some((m) => m.synthetic_reason === "decision_ledger"));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

