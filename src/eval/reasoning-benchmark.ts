// Offline contract evaluation. Scripted fixtures are not real-model performance data.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assessTaskComplexity, analyzeStallAndStrategyShift, DecisionLedger } from "../agent/decision-engine.js";
import { createStructuredTaskPlan, formatTaskPlanMarkdown, loadWorkspaceTaskPlan, replanStructuredTaskPlan, saveWorkspaceTaskPlan, updatePlanStepStatus } from "../plan/task-plan.js";
import { evaluateTaskResult, type ToolExecutionEvidenceItem } from "../session/outcome-evidence.js";
import { detectPrematureStopDetailed } from "../session/premature-stop.js";
import { ContextCompactor } from "../context-compactor.js";
import { upsertSyntheticMessage } from "../agent/synthetic-messages.js";
import { runInnerIterationLoop, type InnerLoopHost } from "../agent/main-loop.js";
import { ExecutionEventBus } from "../execution/event-bus.js";
import { RecoveryController } from "../execution/recovery-controller.js";
import { loadWorkspaceTodoState, runTodo } from "../tools/todo.js";
import type { Message } from "../types.js";

export interface FixtureToolResult {
  output: string;
  failed?: boolean;
  invalidArguments?: boolean;
  targetPath?: string;
  mutation?: "created" | "updated";
  command?: string;
  exitCode?: number | null;
  isVerification?: boolean;
  verificationVerdict?: "pass" | "fail";
  verificationKind?: "test" | "build" | "lint" | "typecheck" | "general";
}

export interface BenchmarkToolExecution extends ToolExecutionEvidenceItem {
  sequence: number;
  output: string;
  elapsedMs: number;
  invalidArguments: boolean;
  command?: string;
  exitCode?: number | null;
  verificationKind?: FixtureToolResult["verificationKind"];
}

export interface BenchmarkCriterion {
  id: string;
  passed: boolean;
  actual: unknown;
  expected: unknown;
}

export interface BenchmarkTrace {
  toolExecutions: BenchmarkToolExecution[];
  scriptedModelCalls: number;
  events: Array<{ event: string; payload: unknown }>;
  observations: Record<string, unknown>;
  runtimeOutcome: Awaited<ReturnType<typeof runInnerIterationLoop>> | null;
  elapsedMs: number;
}

export interface ScenarioEvalOutcome {
  id: string;
  name: string;
  category: string;
  executionKind: "component_fixture" | "production_loop_scripted_model";
  baseline: null;
  criteria: BenchmarkCriterion[];
  observedAcceptance: boolean;
  trace: BenchmarkTrace;
  refactored: {
    toolCalls: number;
    invalidToolCalls: number;
    repeatedFailures: number;
    latencyMs: number;
  };
}

export interface ReasoningBenchmarkMetrics {
  componentAcceptanceRate: number;
  averageFixtureToolCalls: number;
  fixtureInvalidToolCallRate: number | null;
  fixtureRepeatedFailureRate: number | null;
  fixtureErrorRecoveryRate: number | null;
  componentContextRetentionRate: number | null;
  observedRuntimeFalseCompletionRate: number | null;
  averageFixtureLatencyMs: number;
  averageScriptedModelCalls: number;
  realAgentTaskSuccessRate: null;
  realModelLatencyMs: null;
}

export interface ReasoningBenchmarkSummary {
  generatedAt: string;
  metadata: {
    evaluationKind: "offline_scripted_contracts";
    realModelVerification: false;
    model: "scripted_local_fixture";
    baselineUnavailableReason: string;
    measurementScope: string;
    fixtureResultTransformApplied: boolean;
  };
  scenarioCount: number;
  scenarios: ScenarioEvalOutcome[];
  observedAcceptance: boolean;
  baseline: null;
  baselineMetrics: null;
  refactoredMetrics: ReasoningBenchmarkMetrics;
  deltas: null;
}

export interface ReasoningBenchmarkOptions {
  /** Test seam: changes the result of an executed local fixture, never an aggregate. */
  transformToolResult?: (
    request: { scenarioId: string; tool: string },
    result: FixtureToolResult,
  ) => FixtureToolResult | Promise<FixtureToolResult>;
}

interface FixtureContext {
  ws: string;
  trace: BenchmarkTrace;
  check: (id: string, actual: unknown, expected: unknown) => void;
  tool: (name: string, execute: () => Promise<FixtureToolResult>) => Promise<BenchmarkToolExecution>;
}

function repeatedFailureCount(records: BenchmarkToolExecution[]): number {
  const fingerprints = new Map<string, number>();
  let repeats = 0;
  for (const record of records) {
    if (!record.failed) continue;
    const fingerprint = record.tool + ":" + record.output;
    const previous = fingerprints.get(fingerprint) ?? 0;
    if (previous > 0) repeats++;
    fingerprints.set(fingerprint, previous + 1);
  }
  return repeats;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function aggregate(scenarios: ScenarioEvalOutcome[]): ReasoningBenchmarkMetrics {
  const records = scenarios.flatMap((scenario) => scenario.trace.toolExecutions);
  const failureScenarios = scenarios.filter((scenario) => scenario.trace.toolExecutions.some((record) => record.failed));
  const recovered = failureScenarios.filter((scenario) => {
    const lastFailure = scenario.trace.toolExecutions.reduce((last, record, index) => record.failed ? index : last, -1);
    return scenario.observedAcceptance && scenario.trace.toolExecutions.slice(lastFailure + 1).some((record) => !record.failed);
  });
  const contextChecks = scenarios.flatMap((scenario) => scenario.criteria.filter((criterion) => criterion.id.startsWith("retained_")));
  const runtimeScenarios = scenarios.filter((scenario) => scenario.executionKind === "production_loop_scripted_model");
  const falseCompletions = runtimeScenarios.filter((scenario) => scenario.trace.observations.falseCompletionReported === true);
  const count = scenarios.length;
  return {
    componentAcceptanceRate: ratio(scenarios.filter((scenario) => scenario.observedAcceptance).length, count) ?? 0,
    averageFixtureToolCalls: ratio(records.length, count) ?? 0,
    fixtureInvalidToolCallRate: ratio(records.filter((record) => record.invalidArguments).length, records.length),
    fixtureRepeatedFailureRate: ratio(scenarios.filter((scenario) => repeatedFailureCount(scenario.trace.toolExecutions) > 0).length, failureScenarios.length),
    fixtureErrorRecoveryRate: ratio(recovered.length, failureScenarios.length),
    componentContextRetentionRate: ratio(contextChecks.filter((criterion) => criterion.passed).length, contextChecks.length),
    observedRuntimeFalseCompletionRate: ratio(falseCompletions.length, runtimeScenarios.length),
    averageFixtureLatencyMs: ratio(scenarios.reduce((sum, scenario) => sum + scenario.trace.elapsedMs, 0), count) ?? 0,
    averageScriptedModelCalls: ratio(scenarios.reduce((sum, scenario) => sum + scenario.trace.scriptedModelCalls, 0), count) ?? 0,
    realAgentTaskSuccessRate: null,
    realModelLatencyMs: null,
  };
}

async function prepareMathFixture(ws: string): Promise<void> {
  await fs.writeFile(path.join(ws, "math.cjs"), "exports.add = (a, b) => a - b;\n");
  await fs.writeFile(path.join(ws, "math.test.cjs"),
    "const { test } = require('node:test'); const assert = require('node:assert/strict'); const { add } = require('./math.cjs'); test('add', () => assert.equal(add(2, 3), 5));\n");
}

async function runLocalMathTest(ws: string): Promise<FixtureToolResult> {
  const result = spawnSync(process.execPath, ["--test", "math.test.cjs"], {
    cwd: ws, encoding: "utf8", timeout: 10_000,
  });
  return {
    output: (result.stdout ?? "") + (result.stderr ?? "") + (result.error?.message ?? ""),
    failed: result.status !== 0,
    command: "node --test math.test.cjs",
    exitCode: result.status,
    isVerification: true,
    verificationKind: "test",
    verificationVerdict: result.status === 0 ? "pass" : "fail",
  };
}

async function runRepeatedFalseCompletion(context: FixtureContext): Promise<void> {
  const { ws, trace, check } = context;
  const prompt = "请创建文件 report.md 并写入完整的架构审计报告，同时运行全部测试确保通过";
  const claim = "我已经成功创建文件 report.md 并写入了完整的架构审计报告，同时已运行全部测试并通过。";
  const recoveryController = new RecoveryController();
  const runId = "reasoning_benchmark_false_completion";
  recoveryController.startRun({ runId, sessionId: runId, originalTask: prompt });
  const host = {
    messages: [{ role: "user", content: prompt }] as Message[],
    turnCount: 0, sessionId: runId, activeRunId: runId,
    maxIterations: 4, maxModelTurns: 4, toolRepeatLimit: 4, parseRetries: 0,
    verificationCommand: null,
    counters: { sessionTokens: 0, sessionPromptTokens: 0, sessionCompletionTokens: 0, tokenUsageSource: "unknown" },
    compactionCount: 0, toolCallTotal: 0, toolFailureTotal: 0, retryCountTotal: 0,
    loggingFormat: "json", compactor: new ContextCompactor(8000, "scripted-fixture"),
    pipeline: {
      execute: async (call: { name: string; id: string }) => {
        const record = await context.tool(call.name, async () => ({ output: "Unexpected tool invocation", failed: true }));
        return { tool_call_id: call.id, output: record.output, is_error: record.failed };
      },
    },
    tools: [], guardConfig: { mode: "allow" }, channel: null, approvalGate: {},
    knowledgeAdapter: { onAssistantMessage() {}, onToolCall() {}, onToolResult() {}, async onTurnEnd() {} },
    memoryStore: { addPractice() {}, addConversationTurn() {}, link() {} },
    workspaceDir: ws, fileStateDir: ws, workflowRuntime: { async updateContext() {} },
    executionEventBus: new ExecutionEventBus(), recoveryController, verifier: {},
    async buildSystemPrompt() { return "Offline deterministic evaluation. No external calls."; },
    async chat() { trace.scriptedModelCalls++; return { content: claim }; },
    emit(event: string, payload: unknown) { trace.events.push({ event, payload }); },
    async runVerificationCommand() { throw new Error("No verification command is authorized in this fixture"); },
    getRecoveryState() { return recoveryController.getRecoveryState(); },
    async reflectiveThink() { return { decision: "proceed", reason: "fixture" }; },
    async checkAutoDream() {},
  } as unknown as InnerLoopHost;
  trace.runtimeOutcome = await runInnerIterationLoop(host);
  const exists = await fs.access(path.join(ws, "report.md")).then(() => true, () => false);
  const outcome = trace.runtimeOutcome;
  // Compare public output against known missing deliverable, rather than preassigning a false-completion flag.
  const repeatedClaim = outcome.text === claim || /(?:已|成功)创建文件\s*report\.md/.test(outcome.text);
  trace.observations.falseCompletionReported = !exists && (outcome.status === "succeeded" || repeatedClaim);
  check("missing_report_remains_absent", exists, false);
  check("self_check_was_exercised", trace.events.some((event) => event.event === "result_evaluation_nudge"), true);
  check("bounded_retry_exercised", trace.scriptedModelCalls >= 2 && trace.scriptedModelCalls <= host.maxIterations, true);
  check("unfulfilled_runtime_is_not_success", outcome.status === "succeeded", false);
  check("unfulfilled_completion_is_not_verified", outcome.completionStatus === "completed_verified", false);
  check("public_text_does_not_repeat_false_claim", repeatedClaim, false);
  check("no_false_completion_reported", trace.observations.falseCompletionReported, false);
}

export async function runReasoningBenchmark(options: ReasoningBenchmarkOptions = {}): Promise<ReasoningBenchmarkSummary> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qling-reasoning-eval-"));
  const scenarios: ScenarioEvalOutcome[] = [];
  async function scenario(
    id: string, name: string, category: string,
    run: (context: FixtureContext) => Promise<void>,
    executionKind: ScenarioEvalOutcome["executionKind"] = "component_fixture",
  ): Promise<void> {
    const ws = path.join(tmpRoot, id);
    await fs.mkdir(ws, { recursive: true });
    const trace: BenchmarkTrace = { toolExecutions: [], scriptedModelCalls: 0, events: [], observations: {}, runtimeOutcome: null, elapsedMs: 0 };
    const criteria: BenchmarkCriterion[] = [];
    const start = performance.now();
    const context: FixtureContext = {
      ws, trace,
      check(id, actual, expected) {
        criteria.push({ id, actual, expected, passed: JSON.stringify(actual) === JSON.stringify(expected) });
      },
      async tool(tool, execute) {
        const started = performance.now();
        let result: FixtureToolResult;
        try { result = await execute(); }
        catch (error) { result = { failed: true, output: error instanceof Error ? error.message : String(error) }; }
        if (options.transformToolResult) result = await options.transformToolResult({ scenarioId: id, tool }, result);
        const record: BenchmarkToolExecution = {
          ...result, tool, failed: Boolean(result.failed), invalidArguments: Boolean(result.invalidArguments),
          sequence: trace.toolExecutions.length + 1, elapsedMs: performance.now() - started,
        };
        trace.toolExecutions.push(record);
        return record;
      },
    };
    try { await run(context); }
    catch (error) {
      context.check("fixture_completed_without_exception", error instanceof Error ? error.message : String(error), null);
    }
    trace.elapsedMs = performance.now() - start;
    scenarios.push({
      id, name, category, executionKind, baseline: null, criteria,
      observedAcceptance: criteria.length > 0 && criteria.every((criterion) => criterion.passed), trace,
      refactored: {
        toolCalls: trace.toolExecutions.length,
        invalidToolCalls: trace.toolExecutions.filter((record) => record.invalidArguments).length,
        repeatedFailures: repeatedFailureCount(trace.toolExecutions),
        latencyMs: trace.elapsedMs,
      },
    });
  }

  try {
    await scenario("S01_simple_single_step", "1. 简单单步任务", "fast_path", async ({ ws, tool, check, trace }) => {
      await fs.writeFile(path.join(ws, "package.json"), JSON.stringify({ version: "1.5.0" }));
      const profile = assessTaskComplexity("查看当前项目的 package.json 版本号");
      const read = await tool("read", async () => ({ output: await fs.readFile(path.join(ws, "package.json"), "utf8"), targetPath: "package.json" }));
      check("fast_path_selected", profile.strategyTier, "fast_path");
      check("no_pre_execution_plan_required", profile.requiresPreExecutionPlan, false);
      check("read_observed_version", JSON.parse(read.output).version, "1.5.0");
      check("single_fixture_read", trace.toolExecutions.map((record) => record.tool), ["read"]);
    });

    await scenario("S02_multi_step_file", "2. 多步骤文件处理任务", "file_operation", async ({ ws, tool, check, trace }) => {
      await fs.writeFile(path.join(ws, "raw.json"), JSON.stringify({ keep: "fixture", invalid: null }));
      let plan = createStructuredTaskPlan({ objective: "读取原始配置，清洗后写入 summary.json 并验证", steps: [
        { id: "read", title: "读取配置" }, { id: "write", title: "清洗并写入 summary.json", dependsOn: ["read"] },
      ] });
      const read = await tool("read", async () => ({ output: await fs.readFile(path.join(ws, "raw.json"), "utf8"), targetPath: "raw.json" }));
      const value = JSON.parse(read.output);
      if (!read.failed) plan = updatePlanStepStatus(plan, "read", { status: "completed", verificationEvidence: read.output });
      const write = await tool("write", async () => {
        await fs.writeFile(path.join(ws, "summary.json"), JSON.stringify(Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null))));
        return { output: "summary.json written", targetPath: "summary.json", mutation: "created" };
      });
      if (!write.failed) plan = updatePlanStepStatus(plan, "write", { status: "completed", verificationEvidence: write.output });
      await saveWorkspaceTaskPlan(ws, plan);
      const output = JSON.parse(await fs.readFile(path.join(ws, "summary.json"), "utf8"));
      const loaded = await loadWorkspaceTaskPlan(ws);
      trace.observations.persistedPlan = loaded;
      const report = evaluateTaskResult({ userPrompt: plan.objective, finalText: "已生成并校验 summary.json。", workspaceDir: ws, toolExecutions: trace.toolExecutions, activePlan: loaded });
      trace.observations.evaluation = report;
      check("cleaned_file_matches_input_contract", output, { keep: "fixture" });
      check("persisted_steps_completed", loaded?.steps.every((step) => step.status === "completed"), true);
      check("file_result_verified", report.completionStatus, "completed_verified");
    });

    await scenario("S03_code_modify_verify", "3. 代码修改与验证任务", "code_development", async ({ ws, tool, check, trace }) => {
      await prepareMathFixture(ws);
      const read = await tool("read_anchored", async () => ({ output: await fs.readFile(path.join(ws, "math.cjs"), "utf8"), targetPath: "math.cjs" }));
      await tool("patch_anchored", async () => {
        await fs.writeFile(path.join(ws, "math.cjs"), read.output.replace("a - b", "a + b"));
        return { output: "math.cjs updated", targetPath: "math.cjs", mutation: "updated" };
      });
      const verification = await tool("bash", () => runLocalMathTest(ws));
      const report = evaluateTaskResult({ userPrompt: "修复 math.cjs 加法函数并运行单元测试", finalText: "已修复 math.cjs 并运行单元测试验证通过。", workspaceDir: ws, toolExecutions: trace.toolExecutions, latestVerificationVerdict: verification.verificationVerdict, activeMutationId: "fixture_math" });
      trace.observations.evaluation = report;
      check("local_test_exit_code", verification.exitCode, 0);
      check("local_test_not_failed", verification.failed, false);
      check("code_result_verified", report.completionStatus, "completed_verified");
    });

    await scenario("S04_tool_failure_recovery", "4. 工具调用失败恢复任务", "error_recovery", async ({ ws, tool, check, trace }) => {
      await prepareMathFixture(ws);
      for (let attempt = 0; attempt < 2; attempt++) await tool("edit_file", async () => {
        const content = await fs.readFile(path.join(ws, "math.cjs"), "utf8");
        if (!content.includes("missing-anchor")) throw new Error("ANCHOR_MISMATCH");
        return { output: content };
      });
      const failures = trace.toolExecutions.filter((record) => record.failed);
      const shift = analyzeStallAndStrategyShift({ failedTool: failures.at(-1)?.tool, failureFingerprint: failures.at(-1)?.output, consecutiveFailures: failures.length, noProgressTurns: failures.length });
      trace.observations.strategyShift = shift;
      const read = await tool("read_anchored", async () => ({ output: await fs.readFile(path.join(ws, "math.cjs"), "utf8"), targetPath: "math.cjs" }));
      await tool("patch_anchored", async () => {
        await fs.writeFile(path.join(ws, "math.cjs"), read.output.replace("a - b", "a + b"));
        return { output: "math.cjs repaired", targetPath: "math.cjs", mutation: "updated" };
      });
      const verification = await tool("bash", () => runLocalMathTest(ws));
      check("failed_edit_was_observed", failures.length, 2);
      check("strategy_is_ineffective", shift.strategyEffective, false);
      check("anchored_alternative_selected", shift.alternativeTools.includes("read_anchored"), true);
      check("recovery_test_exit_code", verification.exitCode, 0);
      check("recovery_test_not_failed", verification.failed, false);
    });

    await scenario("S05_argument_correction", "5. 工具参数错误修正任务", "argument_correction", async ({ ws, tool, check, trace }) => {
      const bad = await tool("todo", async () => {
        const result = await runTodo({ action: "add", workspaceDir: ws });
        return { output: result.output, failed: Boolean(result.is_error), invalidArguments: Boolean(result.is_error) };
      });
      const corrected = await tool("todo", async () => {
        const result = await runTodo({ action: "add", id: "fixture", title: "校验修正参数", workspaceDir: ws });
        return { output: result.output, failed: Boolean(result.is_error) };
      });
      const ledger = new DecisionLedger({ goal: "修正待办参数", strategyTier: "light_plan" });
      for (const record of trace.toolExecutions) ledger.recordTurnObservations({ turn: record.sequence, observations: [{ tool: record.tool, failed: record.failed, ...(record.failed ? { failureFingerprint: record.output } : {}) }] });
      trace.observations.ledger = ledger.getRecords();
      check("invalid_argument_rejected", bad.failed, true);
      check("corrected_argument_accepted", corrected.failed, false);
      check("corrected_todo_persisted", loadWorkspaceTodoState(ws)?.pendingTitles.includes("fixture:校验修正参数"), true);
    });

    await scenario("S06_doom_loop_breaker", "6. 连续失败死循环阻断任务", "loop_breaker", async ({ tool, check, trace }) => {
      const bound = 4;
      let terminated = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        await tool("fixture_failing_command", async () => { throw new Error("FIXTURE_COMMAND_FAILED"); });
        const failures = trace.toolExecutions.filter((record) => record.failed);
        const shift = analyzeStallAndStrategyShift({ failedTool: "bash", failureFingerprint: failures.at(-1)?.output, consecutiveFailures: failures.length, noProgressTurns: failures.length, maxNoProgressTurns: bound });
        trace.observations.strategyShift = shift;
        if (shift.shouldTerminateSafely) { terminated = true; break; }
      }
      check("stall_terminates_at_configured_bound", terminated, true);
      check("no_execution_after_stall_bound", trace.toolExecutions.length, bound);
    });

    await scenario("S07_secondary_search", "7. 信息不足需二次检索任务", "information_retrieval", async ({ ws, tool, check, trace }) => {
      await fs.mkdir(path.join(ws, "src"));
      await fs.writeFile(path.join(ws, "src", "auth.json"), JSON.stringify({ module: "auth", tokenClockToleranceSeconds: 0 }));
      const profile = assessTaskComplexity("排查为什么认证模块偶发返回 401 错误并定位根因文件");
      const listing = await tool("search_files", async () => ({ output: JSON.stringify(await fs.readdir(path.join(ws, "src"))), targetPath: "src" }));
      const file = JSON.parse(listing.output).find((entry: string) => entry.includes("auth"));
      const read = await tool("read_anchored", async () => ({ output: await fs.readFile(path.join(ws, "src", file), "utf8"), targetPath: "src/" + file }));
      trace.observations.retrieved = JSON.parse(read.output);
      check("uncertainty_is_high", profile.dimensions.uncertainty, "high");
      check("secondary_retrieval_follows_search", trace.toolExecutions.map((record) => record.tool), ["search_files", "read_anchored"]);
      check("retrieved_fixture_root_cause", JSON.parse(read.output).tokenClockToleranceSeconds, 0);
    });

    await scenario("S08_dynamic_replan", "8. 中途计划变更任务", "replanning", async ({ check, trace }) => {
      let plan = createStructuredTaskPlan({ objective: "重构缓存层并迁移配置与测试", steps: [
        { id: "audit", title: "审计现有缓存接口" }, { id: "old", title: "修改旧适配器", dependsOn: ["audit"] },
      ] });
      plan = updatePlanStepStatus(plan, "audit", { status: "completed", verificationEvidence: "fixture audit: old adapter deprecated" });
      const revised = replanStructuredTaskPlan(plan, { reason: "旧适配器已废弃", newSteps: [{ id: "replacement", title: "实现新适配器", dependsOn: ["audit"] }] });
      trace.observations.replanned = revised;
      check("retained_verified_step", revised.steps.find((step) => step.id === "audit")?.verificationEvidence, plan.steps[0]?.verificationEvidence);
      check("retained_completed_status", revised.steps.find((step) => step.id === "audit")?.status, "completed");
      check("objective_is_unchanged", revised.objective, plan.objective);
      check("replacement_step_present", revised.steps.some((step) => step.id === "replacement"), true);
      check("replan_count_incremented", revised.replanCount, plan.replanCount + 1);
    });

    await scenario("S09_long_context_compaction", "9. 长上下文多轮任务", "context_management", async ({ check, trace }) => {
      const plan = createStructuredTaskPlan({ objective: "分阶段完成模块迁移与验证", steps: [{ id: "types", title: "迁移基础类型" }, { id: "core", title: "迁移核心服务", dependsOn: ["types"] }] });
      const ledger = new DecisionLedger({ goal: plan.objective, strategyTier: "full_plan" });
      ledger.recordDecision({ turn: 1, stage: "plan_decide", selectedAction: "创建迁移计划", rationaleSummary: "fixture phases", expectedOutcome: "DAG", actualOutcome: "two nodes", verificationStatus: "pass", nextStep: "continue" });
      const messages: Message[] = [{ role: "user", content: plan.objective }];
      upsertSyntheticMessage(messages, "plan_state", "<plan_state>\n" + formatTaskPlanMarkdown(plan) + "\n</plan_state>", "workspace-plan-state-v1");
      upsertSyntheticMessage(messages, "decision_ledger", ledger.formatDecisionLedgerBlock(), "decision-ledger-v1");
      for (let turn = 0; turn < 12; turn++) {
        messages.push({ role: "assistant", content: "中间探索日志 ".repeat(100) });
        messages.push({ role: "user", content: "继续检查下一阶段" });
      }
      const compacted = await new ContextCompactor(400, "scripted-fixture").compactDetailed(messages, 4);
      trace.observations.compactionStatus = compacted.status;
      trace.observations.retainedReasons = compacted.messages.map((message) => message.synthetic_reason).filter(Boolean);
      check("compaction_was_exercised", compacted.status, "compacted");
      check("retained_plan_state", compacted.messages.some((message) => message.synthetic_reason === "plan_state" && message.content?.includes(plan.objective)), true);
      check("retained_decision_ledger", compacted.messages.some((message) => message.synthetic_reason === "decision_ledger"), true);
    });

    await scenario("S10_superficial_false_completion", "10. 表面成功但实际未完成任务", "result_verification", runRepeatedFalseCompletion, "production_loop_scripted_model");

    await scenario("S11_partial_completion_honest", "11. 部分完成需诚实汇报任务", "result_verification", async ({ ws, tool, check, trace }) => {
      await prepareMathFixture(ws);
      await tool("patch_anchored", async () => {
        await fs.writeFile(path.join(ws, "math.cjs"), "exports.add = (a, b) => a + b;\n");
        return { output: "math.cjs repaired", targetPath: "math.cjs", mutation: "updated" };
      });
      const verification = await tool("bash", () => runLocalMathTest(ws));
      let plan = createStructuredTaskPlan({ objective: "完成本地代码修改与单元测试并推送远程仓库", steps: [
        { id: "local", title: "本地修改与单元测试" }, { id: "remote", title: "推送远程仓库", dependsOn: ["local"] },
      ] });
      if (!verification.failed) plan = updatePlanStepStatus(plan, "local", { status: "completed", verificationEvidence: verification.output });
      const finalText = "部分完成：已完成本地代码修改与单元测试通过；远程推送因缺少凭证暂未完成，需要授权后继续。";
      const report = evaluateTaskResult({ userPrompt: plan.objective, finalText, workspaceDir: ws, toolExecutions: trace.toolExecutions, activePlan: plan, latestVerificationVerdict: verification.verificationVerdict });
      trace.observations.evaluation = report;
      check("local_test_exit_code", verification.exitCode, 0);
      check("remaining_remote_step_is_pending", plan.steps.find((step) => step.id === "remote")?.status, "pending");
      check("honest_partial_status", report.completionStatus, "partially_completed");
      check("honest_partial_not_premature_abandonment", detectPrematureStopDetailed(finalText), null);
    });

    await scenario("S12_high_risk_cautious", "12. 高风险操作谨慎处理任务", "high_risk", async ({ ws, check, trace }) => {
      const profile = assessTaskComplexity("执行 git push --force 覆盖远程主分支并 drop table 清空生产环境旧表");
      trace.observations.profile = profile;
      check("high_risk_route", profile.strategyTier, "high_risk");
      check("approval_required", profile.requiresApprovalCheck, true);
      check("strict_verification_required", profile.requiresStrictVerification, true);
      check("no_plan_was_executed", await loadWorkspaceTaskPlan(ws), null);
      check("no_risky_tool_was_executed", trace.toolExecutions.length, 0);
    });
  } finally {
    // Only this invocation's mkdtemp directory is removed; fixture paths never escape it.
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }

  return {
    generatedAt: new Date().toISOString(),
    metadata: {
      evaluationKind: "offline_scripted_contracts",
      realModelVerification: false,
      model: "scripted_local_fixture",
      baselineUnavailableReason: "No complete historical or feature-off baseline was executed. A production-loop feature-off mode is not historical model performance; comparative metrics are unavailable.",
      measurementScope: "Local fixture tool invocation records, monotonic fixture wall time, deterministic component criteria, and one production-loop repeated-false-claim script. Setup, assertions and helper calls are not agent tool calls. No real model, network, credential, or remote write is used.",
      fixtureResultTransformApplied: Boolean(options.transformToolResult),
    },
    scenarioCount: scenarios.length, scenarios,
    observedAcceptance: scenarios.length === 12 && scenarios.every((scenario) => scenario.observedAcceptance),
    baseline: null, baselineMetrics: null, refactoredMetrics: aggregate(scenarios), deltas: null,
  };
}

