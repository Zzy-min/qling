#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseAgentEvalOutput } from "../dist/eval/agent-output.js";
import { buildSwebenchAgentEnvironment, decideSwebenchSourcePrediction, diagnosticArtifactPathspecExclusions, isOfficialGraderPendingCandidate, isSupportedSwebenchModelRoute } from "../dist/eval/swebench-prediction.js";
import { resolveExplicitDeliverablePaths } from "../dist/diagnostic-artifact.js";
import {
  canStartBudgetedTask,
  estimateModelCostCny,
  resolveCostPricesCny,
} from "../dist/cost-budget.js";
import { loadQlingConfig } from "../dist/config.js";
import dotenv from "dotenv";

const enabled = /^(1|true|on|yes)$/i.test(String(process.env.QLING_EVAL_LLM ?? ""));
const dryRun = /^(1|true|on|yes)$/i.test(String(process.env.QLING_SWEBENCH_DRY_RUN ?? ""));
dotenv.config({ path: join(process.env.USERPROFILE || process.env.HOME || "", ".qling", ".env"), quiet: true });
const loaded = await loadQlingConfig({});
const apiKey = process.env.QLING_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || loaded.config.llm.api_key;
if (!dryRun && (!enabled || !apiKey)) {
  console.log(JSON.stringify({ eval: "swebench-lite", status: "skip", reason: enabled ? "missing API key" : "QLING_EVAL_LLM is not enabled" }));
  process.exit(0);
}

const requested = (process.env.QLING_SWEBENCH_INSTANCES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const sampleLimit = Math.max(1, Math.min(300, Number(process.env.QLING_SWEBENCH_LIMIT ?? 30)));
const requestedVariant = String(process.env.QLING_RELIABILITY_VARIANT ?? "legacy").toLowerCase();
const variant = /^(v3|reliability-v3)$/.test(requestedVariant)
  ? "v3"
  : /^(v2|reliability-v2)$/.test(requestedVariant)
    ? "v2"
    : "legacy";
const provider = process.env.QLING_LLM_PROVIDER || loaded.config.llm.provider;
const model = process.env.QLING_LLM_MODEL || loaded.config.llm.model;
const endpoint = process.env.QLING_LLM_ENDPOINT || loaded.config.llm.endpoint;
if (!isSupportedSwebenchModelRoute({ provider, endpoint, model })) {
  throw new Error(`SWE-bench paid evaluation requires an approved DeepSeek route, got ${provider}/${model}`);
}
const perTaskMaxCny = Math.max(0.01, Number(process.env.QLING_SWEBENCH_TASK_MAX_CNY ?? 4));
const batchMaxCny = Math.max(0.01, Number(process.env.QLING_SWEBENCH_BATCH_MAX_CNY ?? 50));
const availableCny = Math.max(0, Number(process.env.QLING_SWEBENCH_AVAILABLE_CNY ?? 70));
const reserveCny = Math.max(0, Number(process.env.QLING_SWEBENCH_RESERVE_CNY ?? 15));
const effectiveBatchMaxCny = Math.min(batchMaxCny, Math.max(0, availableCny - reserveCny));
const pricesCny = resolveCostPricesCny(process.env);
const taskTimeoutMs = Math.max(10_000, Number(process.env.QLING_SWEBENCH_TASK_TIMEOUT_MS ?? 1_800_000));
const acceptance = {
  maxTotalTokens: Math.max(1, Number(process.env.QLING_SWEBENCH_MAX_TOTAL_TOKENS ?? 832_314)),
  maxToolCalls: Math.max(0, Number(process.env.QLING_SWEBENCH_MAX_TOOL_CALLS ?? 38)),
  maxToolFailures: Math.max(0, Number(process.env.QLING_SWEBENCH_MAX_TOOL_FAILURES ?? 8)),
  maxDurationMs: Math.max(1_000, Number(process.env.QLING_SWEBENCH_MAX_DURATION_MS ?? 170_000)),
};
if (dryRun) {
  console.log(JSON.stringify({
    eval: "swebench-lite-preflight",
    status: "ready",
    paidRequestStarted: false,
    requestedInstances: requested,
    sampleLimit,
    variant,
    provider,
    model,
    keyPresent: Boolean(apiKey),
    budget: {
      perTaskMaxCny,
      batchMaxCny: effectiveBatchMaxCny,
      reserveCny,
      pricingBasis: "conservative_cache_miss",
      inputCnyPerMillion: pricesCny.inputPerMillion,
      outputCnyPerMillion: pricesCny.outputPerMillion,
    },
    taskTimeoutMs,
    acceptance,
  }, null, 2));
  process.exit(0);
}
const inlineRows = process.env.QLING_SWEBENCH_ROWS_JSON?.trim();
let allRows;
if (inlineRows) {
  const parsedRows = JSON.parse(inlineRows);
  if (!Array.isArray(parsedRows) || parsedRows.some((row) => !row?.instance_id || !row?.repo || !row?.base_commit || !row?.problem_statement)) {
    throw new Error("QLING_SWEBENCH_ROWS_JSON must be an array of public SWE-bench task rows");
  }
  allRows = parsedRows;
} else {
  const endpoints = [0, 100, 200].map((offset) =>
    `https://datasets-server.huggingface.co/rows?dataset=SWE-bench%2FSWE-bench_Lite&config=default&split=test&offset=${offset}&length=100`
  );
  const payloads = await Promise.all(endpoints.map(async (endpoint) => {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`failed to fetch SWE-bench Lite rows: ${response.status}`);
    return response.json();
  }));
  allRows = payloads.flatMap((payload) => payload.rows.map((entry) => entry.row));
}
const available = new Map(allRows.map((row) => [row.instance_id, row]));
const instances = (requested.length > 0 ? requested : allRows.slice(0, sampleLimit).map((row) => row.instance_id)).map((id) => {
  const row = available.get(id);
  if (!row) throw new Error(`SWE-bench instance not found in selected range: ${id}`);
  return row;
});

const runId = `qling-deepseek-${variant}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const artifactDir = resolve(process.env.QLING_SWEBENCH_ARTIFACT_DIR ?? join(process.cwd(), "artifacts", runId));
const budgetLedgerPath = process.env.QLING_SWEBENCH_BUDGET_LEDGER
  ? resolve(process.env.QLING_SWEBENCH_BUDGET_LEDGER)
  : null;
const scratch = join(tmpdir(), runId);
await rm(scratch, { recursive: true, force: true });
await mkdir(scratch, { recursive: true });
await mkdir(artifactDir, { recursive: true });

const nonAgentEnv = { ...process.env };
for (const key of Object.keys(nonAgentEnv)) {
  if (/^(?:QLING_LLM_API_KEY|DEEPSEEK_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)$/i.test(key)) {
    delete nonAgentEnv[key];
  }
}

function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...options,
      env: options.env ?? nonAgentEnv,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const outputLimit = 16 * 1024 * 1024;
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { if (stdout.length < outputLimit) stdout = (stdout + chunk).slice(0, outputLimit); });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { if (stderr.length < outputLimit) stderr = (stderr + chunk).slice(0, outputLimit); });
    let timedOut = false;
    let forceTimer = null;
    const timer = options.timeout ? setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && child.pid) spawn("taskkill.exe", ["/PID", String(child.pid), "/T"], { windowsHide: true, stdio: "ignore" });
      else child.kill("SIGTERM");
      forceTimer = setTimeout(() => {
        if (process.platform === "win32" && child.pid) spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        else child.kill("SIGKILL");
      }, 15_000);
    }, options.timeout) : null;
    child.once("error", reject);
    child.once("close", (code) => {
      if (timer) clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      resolvePromise({ code, stdout, stderr, timedOut });
    });
  });
}

const predictions = [];
const trajectories = [];
let estimatedSpentCny = 0;
if (budgetLedgerPath) {
  try {
    const ledger = JSON.parse(await readFile(budgetLedgerPath, "utf8"));
    estimatedSpentCny = Math.max(0, Number(ledger.estimatedSpentCny ?? 0));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
const estimatedSpentBeforeRunCny = estimatedSpentCny;
let budgetStopped = false;
async function readLatestCheckpoint(stateDir) {
  const directory = join(stateDir, "run-checkpoints");
  try {
    const files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    const checkpoints = await Promise.all(files.map(async (name) => JSON.parse(await readFile(join(directory, name), "utf8"))));
    return checkpoints.sort((left, right) => Number(right.savedAt ?? 0) - Number(left.savedAt ?? 0))[0] ?? null;
  } catch { return null; }
}
async function persistBudgetLedger() {
  if (!budgetLedgerPath) return;
  await mkdir(dirname(budgetLedgerPath), { recursive: true });
  const tempPath = `${budgetLedgerPath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify({ estimatedSpentCny, updatedAt: new Date().toISOString() })}\n`, "utf8");
  await rename(tempPath, budgetLedgerPath);
}
async function persistArtifacts() {
  await writeFile(join(artifactDir, "predictions.json"), `${JSON.stringify(predictions, null, 2)}\n`, "utf8");
  await writeFile(
    join(artifactDir, "predictions.jsonl"),
    predictions.map((prediction) => JSON.stringify(prediction)).join("\n") + (predictions.length ? "\n" : ""),
    "utf8"
  );
  await writeFile(join(artifactDir, "trajectories.json"), `${JSON.stringify(trajectories, null, 2)}\n`, "utf8");
}

async function retry(command, args, options, attempts = 3) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await run(command, args, options);
    if (last.code === 0) return last;
    if (attempt < attempts) await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 1_000));
  }
  return last;
}

try {
  for (const instance of instances) {
    // Cost remains observable, but reliability evaluation is not stopped by a CNY threshold.
    const workspace = join(scratch, instance.instance_id);
    const home = join(scratch, `${instance.instance_id}-home`);
    await mkdir(home, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await run("git", ["init", "-q"], { cwd: workspace, timeout: 30_000 });
    await run("git", ["remote", "add", "origin", `https://github.com/${instance.repo}.git`], { cwd: workspace, timeout: 30_000 });
    const fetchCommit = await retry("git", ["fetch", "--depth=1", "origin", instance.base_commit], { cwd: workspace, timeout: 180_000 });
    if (fetchCommit.code !== 0) {
      trajectories.push({ instanceId: instance.instance_id, repo: instance.repo, baseCommit: instance.base_commit, generationError: `git fetch failed: ${fetchCommit.stderr.slice(-1000)}` });
      predictions.push({ instance_id: instance.instance_id, model_name_or_path: `qling/${provider}/${model}`, model_patch: "" });
      await persistArtifacts();
      continue;
    }
    const checkout = await run("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: workspace, timeout: 120_000 });
    if (checkout.code !== 0) {
      trajectories.push({ instanceId: instance.instance_id, repo: instance.repo, baseCommit: instance.base_commit, generationError: `git checkout failed: ${checkout.stderr.slice(-1000)}` });
      predictions.push({ instance_id: instance.instance_id, model_name_or_path: `qling/${provider}/${model}`, model_patch: "" });
      await persistArtifacts();
      continue;
    }

    const prompt = [
      "你正在解决一个真实 SWE-bench Lite GitHub issue。请检查大型仓库并实现最小、正确、兼容的修复。",
      "不要读取金标准补丁，不要修改测试，不要提交。必须运行最相关的现有测试；如果环境依赖阻止测试，报告准确原因但仍完成代码修复。",
      "Issue:",
      instance.problem_statement,
    ].join("\n\n");
    const started = Date.now();
    let agent;
    let generationError;
    const agentStateDir = join(scratch, `${instance.instance_id}-state`);
    try {
      agent = await run(process.execPath, [join(process.cwd(), "dist", "index.js"), "run", "--json", "--code-runtime", "auto", prompt], {
        cwd: workspace,
        timeout: taskTimeoutMs,
        env: buildSwebenchAgentEnvironment({
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        QLING_FILE_STATE_DIR: agentStateDir,
        QLING_FILE_CACHE_DIR: join(scratch, `${instance.instance_id}-cache`),
        QLING_METRICS_DIR: join(scratch, `${instance.instance_id}-metrics`),
        QLING_WORKSPACE_DIR: workspace,
        QLING_LLM_API_KEY: apiKey,
        QLING_LLM_PROVIDER: provider,
        QLING_LLM_MODEL: model,
        QLING_LLM_ENDPOINT: endpoint,
        QLING_RUN_MAX_COST_CNY: "",
        QLING_COST_INPUT_CNY_PER_MILLION: String(pricesCny.inputPerMillion),
        QLING_COST_OUTPUT_CNY_PER_MILLION: String(pricesCny.outputPerMillion),
        QLING_BOOT_QUIET: "true",
        QLING_DASHBOARD_ENABLED: "false",
        QLING_METRICS_OTEL_ENABLED: "false",
        QLING_GUARD_PERMISSIONS_DEFAULT: "allow",
        QLING_SANDBOX_PROFILE: "workspace",
        QLING_FEATURES_RELIABILITY_V2: variant !== "legacy" ? "true" : "false",
        QLING_FEATURES_TRUST_BOUNDARY: variant !== "legacy" ? "true" : "false",
        QLING_REQUIRE_WORKSPACE_MUTATION: variant !== "legacy" ? "true" : "false",
        QLING_TOOL_ALLOWLIST: "read,search,patch,write,bash,verify,code_symbols,lsp,read_anchored,patch_anchored,repo_map,repo_query,impact_analysis,tool_search",
        }),
      });
    } catch (error) {
      generationError = error instanceof Error ? error.message : String(error);
      agent = {
        code: null,
        stdout: typeof error?.stdout === "string" ? error.stdout : "",
        stderr: typeof error?.stderr === "string" ? error.stderr : "",
      };
    }
    let parsed = { ok: false, usage: {}, tools: [], toolCalls: 0, toolFailures: 0 };
    try {
      parsed = parseAgentEvalOutput(agent.stdout);
    } catch (error) {
      generationError ??= error instanceof Error ? error.message : String(error);
    }
    const checkpoint = await readLatestCheckpoint(agentStateDir);
    if (checkpoint) {
      const checkpointUsage = checkpoint.usage ?? {};
      parsed.usage = {
        ...parsed.usage,
        promptTokens: Math.max(Number(parsed.usage.promptTokens ?? 0), Number(checkpointUsage.promptTokens ?? 0)),
        completionTokens: Math.max(Number(parsed.usage.completionTokens ?? 0), Number(checkpointUsage.completionTokens ?? 0)),
        totalTokens: Math.max(Number(parsed.usage.totalTokens ?? 0), Number(checkpointUsage.totalTokens ?? 0)),
        usageIsIncomplete: agent.timedOut === true || checkpointUsage.usageIsIncomplete === true,
      };
      parsed.toolCalls = Math.max(parsed.toolCalls, Number(checkpoint.toolMetrics?.calls ?? 0));
      parsed.toolFailures = Math.max(parsed.toolFailures, Number(checkpoint.toolMetrics?.failures ?? 0));
    }
    const untracked = await run("git", ["ls-files", "--others", "--exclude-standard"], { cwd: workspace, timeout: 30_000 });
    const untrackedFiles = untracked.stdout.trim().split(/\r?\n/).filter(Boolean);
    let untrackedPatch = "";
    for (const relative of untrackedFiles) {
      const addition = await run("git", ["diff", "--binary", "--no-index", "--", process.platform === "win32" ? "NUL" : "/dev/null", relative], { cwd: workspace, timeout: 30_000 });
      untrackedPatch += addition.stdout;
    }
    const trackedDiff = await run("git", ["diff", "--binary", "HEAD"], { cwd: workspace, timeout: 30_000 });
    const diff = { ...trackedDiff, stdout: `${trackedDiff.stdout}${untrackedPatch}` };
    const changed = await run("git", ["diff", "--name-only", "HEAD"], { cwd: workspace, timeout: 30_000 });
    const reportedEstimatedCostCny = estimateModelCostCny({
      promptTokens: Number(parsed.usage.promptTokens ?? 0),
      completionTokens: Number(parsed.usage.completionTokens ?? 0),
    }, pricesCny);
    const estimatedCostCny = reportedEstimatedCostCny;
    estimatedSpentCny += estimatedCostCny;
    await persistBudgetLedger();
    const changedFiles = [...new Set([...changed.stdout.trim().split(/\r?\n/).filter(Boolean), ...untrackedFiles])];
    const rawPatchName = `${instance.instance_id}.raw-workspace.patch`;
    await writeFile(join(artifactDir, rawPatchName), diff.stdout, "utf8");
    const explicitDeliverableFiles = resolveExplicitDeliverablePaths(workspace);
    const explicitDeliverableSet = new Set(explicitDeliverableFiles);
    const diagnosticFiles = diagnosticArtifactPathspecExclusions(
      untrackedFiles.filter((file) => !explicitDeliverableSet.has(file.replace(/\\/g, "/"))),
      diff.stdout,
    );
    const sourceTracked = diagnosticFiles.length > 0
      ? await run("git", ["diff", "--binary", "HEAD", "--", ".", ...diagnosticFiles.flatMap((file) => [`:(exclude)${file}`])], { cwd: workspace, timeout: 30_000 })
      : trackedDiff;
    let sourceUntrackedPatch = "";
    for (const relative of untrackedFiles.filter((file) => !diagnosticFiles.includes(file))) {
      const addition = await run("git", ["diff", "--binary", "--no-index", "--", process.platform === "win32" ? "NUL" : "/dev/null", relative], { cwd: workspace, timeout: 30_000 });
      sourceUntrackedPatch += addition.stdout;
    }
    const sourcePatch = `${sourceTracked.stdout}${sourceUntrackedPatch}`;
    const sourcePatchName = `${instance.instance_id}.agent-source.patch`;
    await writeFile(join(artifactDir, sourcePatchName), sourcePatch, "utf8");
    const officialGraderPending = isOfficialGraderPendingCandidate({
      agentOutcome: parsed.outcome,
      resultText: parsed.resultText,
      checkpoint,
    });
    const predictionDecision = decideSwebenchSourcePrediction({
      agentResultOk: parsed.ok === true,
      officialGraderPending,
      latestVerificationVerdict: checkpoint?.latestVerification?.verdict,
      rawPatch: diff.stdout,
      sourcePatch,
      changedFiles,
      untrackedFiles,
      deliverableFiles: explicitDeliverableFiles,
      diagnosticFiles,
    });
    predictions.push({
      instance_id: instance.instance_id,
      model_name_or_path: `qling/${provider}/${model}`,
      model_patch: predictionDecision.modelPatch,
    });
    trajectories.push({
      instanceId: instance.instance_id,
      variant,
      repo: instance.repo,
      baseCommit: instance.base_commit,
      durationMs: Date.now() - started,
      agentExitCode: agent.code,
      agentResultOk: parsed.ok,
      agentOutcome: parsed.outcome,
      officialGraderPending,
      tools: parsed.tools,
      ...(parsed.efficiencySignals ? { efficiencySignals: parsed.efficiencySignals } : {}),
      toolCalls: parsed.toolCalls,
      toolFailures: parsed.toolFailures,
      usage: parsed.usage,
      estimatedCostCny,
      cumulativeEstimatedCostCny: estimatedSpentCny,
      changedFiles,
      patchBytes: Buffer.byteLength(diff.stdout),
      sourcePatchBytes: Buffer.byteLength(sourcePatch),
      rawPatchArtifact: rawPatchName,
      sourcePatchArtifact: sourcePatchName,
      predictionEligible: predictionDecision.eligible,
      ...(predictionDecision.reason ? { predictionRejectionReason: predictionDecision.reason } : {}),
      stderrTail: agent.stderr.slice(-2000),
      ...(generationError ? { generationError } : {}),
      ...(agent.timedOut ? { timedOut: true } : {}),
      ...(checkpoint ? { checkpoint: { sequence: checkpoint.sequence, phase: checkpoint.phase, workspaceDiffArtifact: checkpoint.workspaceDiffArtifact, usagePartial: checkpoint.usage?.usageIsIncomplete === true } } : {}),
    acceptance: {
      totalTokens: Number(parsed.usage.totalTokens ?? 0),
      maxTotalTokens: acceptance.maxTotalTokens,
      totalTokensPassed: Number(parsed.usage.totalTokens ?? 0) <= acceptance.maxTotalTokens,
      maxToolCalls: acceptance.maxToolCalls,
      toolCallsPassed: parsed.toolCalls <= acceptance.maxToolCalls,
      maxToolFailures: acceptance.maxToolFailures,
      toolFailuresPassed: parsed.toolFailures <= acceptance.maxToolFailures,
      maxDurationMs: acceptance.maxDurationMs,
      durationPassed: Date.now() - started <= acceptance.maxDurationMs,
    },
    });
    await persistArtifacts();
    console.error(`[swebench] ${instance.instance_id}: exit=${agent.code} patch=${Buffer.byteLength(diff.stdout)}B tools=${parsed.toolCalls}`);
  }
  console.log(JSON.stringify({
    eval: "swebench-lite-generation",
    status: predictions.length === instances.length && predictions.every((prediction) => prediction.model_patch.trim())
      ? trajectories.every((trajectory) => trajectory.agentResultOk === true)
        ? "generation_complete"
        : "candidate_ready_for_official_grader"
      : "generation_incomplete",
    runId,
    variant,
    requestedSampleSize: instances.length,
    completedSampleSize: trajectories.length,
    artifactDir,
    predictions: predictions.length,
    trajectories,
    budget: {
      perTaskMaxCny,
      batchMaxCny: effectiveBatchMaxCny,
      reserveCny,
      estimatedSpentCny,
      runEstimatedCostCny: estimatedSpentCny - estimatedSpentBeforeRunCny,
      ledgerPath: budgetLedgerPath,
      stopped: budgetStopped,
      pricingBasis: "conservative_cache_miss",
    },
    evidence: {
      executor: "agent",
      model: "real",
      verifier: "pending_official_swebench_docker_grader",
      claim: "Generates patches for selected official SWE-bench Lite instances without exposing gold patches.",
      limitations: ["Patch generation is not a success result until the official Docker grader completes."],
    },
  }));
} finally {
  if (process.env.QLING_KEEP_SWEBENCH_WORKSPACES !== "1") await rm(scratch, { recursive: true, force: true });
}
