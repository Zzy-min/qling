// Deterministic interrupted-run eval. Uses dist only. Writes nothing under ~/.qling.
// Simulates a turn killed after N tool results by planting a session snapshot,
// an open run trace, a running mission owned by a dead pid, and a long background output.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const REMINDER_MARK = "上一轮在完成前被中断";

function countReminders(messages) {
  return messages.filter((message) => typeof message?.content === "string" && message.content.includes(REMINDER_MARK)).length;
}

async function deadPid() {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], { stdio: "ignore" });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const pid = child.pid;
  if (!pid) throw new Error("spawned child has no pid");
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
  return pid;
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "qling-interrupted-eval-"));
  const stateDir = path.join(root, "state");
  const cacheDir = path.join(root, "cache");
  const workspace = path.join(root, "workspace");
  const bgState = path.join(root, "bg");
  process.env.QLING_FILE_STATE_DIR = stateDir;
  process.env.QLING_FILE_CACHE_DIR = cacheDir;
  process.env.QLING_WORKSPACE_DIR = workspace;
  process.env.QLING_MEMORY_WAL_ENABLED = "false";
  process.env.QLING_JSON_HOOKS_ENABLED = "false";
  process.env.QLING_FEATURES_DYNAMIC_DISCOVERY = "false";
  process.env.QLING_FEATURES_SEMANTIC_MEMORY = "false";
  process.env.QLING_MEMORY_DREAM_LLM_ENABLED = "false";
  process.env.QLING_FEATURES_DASHBOARD = "false";
  process.env.QLING_METRICS_ENABLED = "false";
  process.env.QLING_RUNTIME_MODE = "legacy";
  delete process.env.QLING_FEATURES_RELIABILITY_V2;

  try {
    await mkdir(workspace, { recursive: true });
    await mkdir(path.join(stateDir, "missions"), { recursive: true });
    await mkdir(path.join(stateDir, "sessions"), { recursive: true });

    const ownerPid = await deadPid();
    const sessionId = "sess_eval";
    const runId = "run_eval";
    const now = Date.now();
    const mission = {
      id: "msn_eval",
      name: "interrupted eval",
      description: "running when the owner process died",
      status: "running",
      sessionId,
      ownerPid,
      lastContext: [],
      metrics: { startTime: now, totalTurns: 1, totalTokens: 0, totalToolCalls: 2 },
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(path.join(stateDir, "missions", "msn_eval.json"), JSON.stringify(mission, null, 2));

    const toolCalls = [1, 2, 3].map((index) => ({
      id: `call_${index}`,
      type: "function",
      function: { name: "bash", arguments: JSON.stringify({ command: `echo ${index}` }) },
    }));
    const messages = [
      { role: "user", content: "run three tools then get killed" },
      { role: "assistant", content: "running tools", tool_calls: toolCalls },
      { role: "tool", tool_call_id: "call_1", content: "KEPT_TOOL_RESULT_1" },
      { role: "tool", tool_call_id: "call_2", content: "KEPT_TOOL_RESULT_2" },
    ];
    const snapshot = {
      version: 1,
      name: "interrupted-eval",
      sessionId,
      workspaceDir: workspace,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      messages,
      turnCount: 1,
      sessionTokens: 10,
      compactionCount: 0,
      activeRun: { runId, sessionId, originalTask: "run three tools then get killed", startedAt: now },
    };
    await writeFile(path.join(stateDir, "sessions", "interrupted-eval.json"), JSON.stringify(snapshot, null, 2));

    const traceDir = path.join(stateDir, "runs", sessionId);
    await mkdir(traceDir, { recursive: true });
    const tracePath = path.join(traceDir, `${runId}.jsonl`);
    await writeFile(
      tracePath,
      `${JSON.stringify({ eventId: "evt_start", runId, sessionId, type: "run_started", timestamp: now, status: "running" })}\n`,
    );

    const { AgentLoop } = await import("../dist/agent-loop.js");
    const { BackgroundTaskRegistry } = await import("../dist/runtime/background-tasks.js");

    const agentConfig = {
      apiKey: "eval-not-a-real-key",
      provider: "openai",
      endpoint: "http://127.0.0.1:9/v1",
      model: "eval-model",
      runtime: {
        workspaceDir: workspace,
        fileStateDir: stateDir,
        fileCacheDir: cacheDir,
      },
    };

    const agent = new AgentLoop(agentConfig);
    await agent.waitForInit();
    const missionStatusAfterRestart = agent.getMissionManager().getMission("msn_eval")?.status ?? null;
    const loaded = await agent.loadSession("interrupted-eval");
    if (!loaded) throw new Error("failed to load interrupted-eval session");
    const firstMessages = agent.getMessagesSnapshot();
    const traceAfter = await readFile(tracePath, "utf8");
    const reminderCount = countReminders(firstMessages);
    const toolResultsKept = firstMessages.filter((message) => message.role === "tool" && String(message.content).includes("KEPT_TOOL_RESULT_")).length;
    const toolCallsInRound = firstMessages
      .filter((message) => message.role === "assistant")
      .reduce((total, message) => total + (Array.isArray(message.tool_calls) ? message.tool_calls.length : 0), 0);
    const interruptedDetected = reminderCount > 0 || traceAfter.includes('"status":"interrupted"');

    const reloaded = new AgentLoop(agentConfig);
    await reloaded.waitForInit();
    if (!await reloaded.loadSession("interrupted-eval")) throw new Error("failed to reload interrupted-eval session");
    const reminderCountAfterReload = countReminders(reloaded.getMessagesSnapshot());

    const registry = new BackgroundTaskRegistry({ persist: false, stateDir: bgState });
    const head = `BG_HEAD\n${"H".repeat(70 * 1024)}`;
    const tail = `${"T".repeat(64)}\nBG_TAIL`;
    const task = registry.startPromise({
      label: "eval-bg-output",
      cwd: workspace,
      promise: Promise.resolve(`${head}${"M".repeat(600 * 1024)}${tail}`),
      timeoutMs: 10_000,
    });
    const finished = await registry.wait(task.taskId, 5_000);
    const bgOutputKeepsTail = finished.output.includes("BG_HEAD") && finished.output.includes("BG_TAIL");

    process.stdout.write(`${JSON.stringify({
      toolResultsKept,
      toolCallsInRound,
      interruptedDetected,
      reminderCount,
      reminderCountAfterReload,
      missionStatusAfterRestart,
      bgOutputKeepsTail,
    })}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
