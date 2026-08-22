// ============================================================
// 写操作验证闭环（从 AgentLoop 抽出）
// StagedVerifier 驱动恢复；无 stage 时仅 advisory
// ============================================================

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { Message } from "../types.js";
import type { VerificationAgent } from "../pipeline/verification.js";
import { StagedVerifier } from "./staged-verifier.js";
import {
  formatVerificationStagesSummary,
  resolveVerificationStages,
} from "./verification-stages.js";
import { classifyFailure } from "./failure-classifier.js";
import type { RecoveryController } from "./recovery-controller.js";
import type { ExecutionEventBus } from "./event-bus.js";
import type { ProgressSnapshot, RecoveryState } from "./types.js";
import {
  buildVerificationFailureUserMessage,
  formatRecoveryInstruction,
  formatRecoveryPause,
} from "./recovery-messages.js";
import type { PreparedToolCall } from "../agent/tool-orchestrator.js";
import type { ToolExecutionObservation } from "../agent/run-efficiency.js";
import type { ProjectProfile } from "../runtime/project-profile.js";
import { resolveScopedVerificationCommand } from "../runtime/project-profile.js";
import { buildSafeEnv } from "../tools/bash.js";
import { runManagedCommand } from "./managed-command.js";
import { resolveProjectProfileIdentity } from "../runtime/project-profile.js";

export type ShellResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  terminationConfirmed?: boolean;
};

export function runShellCommand(cmd: string, cwd: string, runtime: "native" | "wsl" = "native"): Promise<ShellResult> {
  return runManagedCommand({ command: cmd, cwd, runtime, env: buildSafeEnv([], {}), timeoutMs: 600_000 });
}

export async function getWorkspaceDiffHash(
  runCommand: (cmd: string) => Promise<ShellResult>
): Promise<string> {
  const result = await runCommand("git diff --no-ext-diff --binary");
  const content = result.code === 0 ? result.stdout : "git-unavailable";
  return createHash("sha256").update(content).digest("hex").slice(0, 20);
}

export async function getWorkspaceChangedFiles(
  runCommand: (cmd: string) => Promise<ShellResult>
): Promise<string[]> {
  const result = await runCommand("git status --porcelain");
  if (result.code !== 0 || !result.stdout.trim()) return [];
  const names = new Set<string>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const body = trimmed.slice(2).trim();
    const pathPart = body.includes(" -> ") ? body.split(" -> ").pop()! : body;
    const base = path.basename(pathPart.replace(/^"+|"+$/g, ""));
    if (base) names.add(base);
    if (names.size >= 20) break;
  }
  return [...names].sort();
}

export async function buildVerificationProgress(
  failingTests: string[],
  runCommand: (cmd: string) => Promise<ShellResult>
): Promise<ProgressSnapshot> {
  const [diffHash, changedFiles] = await Promise.all([
    getWorkspaceDiffHash(runCommand),
    getWorkspaceChangedFiles(runCommand),
  ]);
  return {
    diffHash,
    failingTests: [...failingTests],
    changedFiles,
    changed: changedFiles.length > 0,
  };
}

export async function persistVerificationCommand(
  workspaceDir: string,
  verificationCommand: string | null
): Promise<void> {
  const filePath = path.join(workspaceDir, ".qling-verify.json");
  try {
    if (verificationCommand) {
      await fs.writeFile(
        filePath,
        JSON.stringify({ verificationCommand }, null, 2),
        "utf-8"
      );
    } else if (existsSync(filePath)) {
      await fs.unlink(filePath);
    }
  } catch (err) {
    console.error(
      "[verification] Failed to persist verification command: " + (err as Error).message
    );
  }
}

export async function loadVerificationCommand(
  workspaceDir: string
): Promise<string | null> {
  const filePath = path.join(workspaceDir, ".qling-verify.json");
  if (!existsSync(filePath)) return null;
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content) as { verificationCommand?: string | null };
    return data.verificationCommand ?? null;
  } catch (err) {
    console.error(
      "[verification] Failed to load verification command: " + (err as Error).message
    );
    return null;
  }
}

export async function runAdvisoryVerification(options: {
  messages: Message[];
  verifier: VerificationAgent;
  emit: (event: string, ...args: unknown[]) => void;
}): Promise<void> {
  const toolMsgs = options.messages.filter((m) => m.role === "tool");
  if (toolMsgs.length === 0) return;

  try {
    const lastResult = JSON.parse(toolMsgs[toolMsgs.length - 1].content!);
    if (lastResult?.is_error === true) {
      const details = String(lastResult.error?.message ?? lastResult.output ?? "tool execution failed");
      console.error("❌ 旁路验证(非恢复驱动): FAIL");
      console.error("   详情: " + details);
      options.emit("verification", "FAIL", details);
      return;
    }
    const vr = await options.verifier.verify(
      "文件操作/Bash执行",
      "操作成功完成",
      lastResult.output
    );
    const icon = vr.verdict === "PASS" ? "✅" : vr.verdict === "FAIL" ? "❌" : "⚠️";
    console.error(icon + " 旁路验证(非恢复驱动): " + vr.verdict);
    if (vr.verdict !== "PASS") {
      console.error("   详情: " + vr.details);
      console.error("   提示: 设置 /verify set 或 QLING_VERIFY_* 以启用命令级恢复验证");
    }
    options.emit("verification", vr.verdict, vr.details ?? vr.verdict);
  } catch {
    // ignore advisory failures
  }
}

export type WriteVerificationOutcome =
  | { kind: "noop" }
  | { kind: "pass"; summary: string; verificationBaseFingerprint: string; workspaceFingerprint: string }
  | { kind: "advisory" }
  | { kind: "audit"; text: string }
  | {
      kind: "recover";
      userMessage: string;
      strategy: string;
      strategyAttempts: number;
      failureMessage: string;
    }
  | { kind: "pause"; text: string };

export interface WriteVerificationDeps {
  verificationCommand: string | null;
  runCommand: (cmd: string, runtime?: "native" | "wsl") => Promise<ShellResult>;
  projectProfile?: ProjectProfile;
  workspaceDir?: string;
  observations?: ToolExecutionObservation[];
  recoveryController: RecoveryController;
  executionEventBus: ExecutionEventBus;
  emit: (event: string, ...args: unknown[]) => void;
  getRecoveryState: () => RecoveryState | null;
  verifier: VerificationAgent;
  messages: Message[];
  runId: string;
}

function verificationEnvironmentBlocker(
  stdout: string,
  stderr: string,
  changedPaths: readonly string[],
): string | null {
  const output = `${stdout}\n${stderr}`;
  const removedCollectionsImport = output.match(
    /ImportError:\s*cannot import name ['"](?:Mapping|MutableMapping|MutableSequence|Sequence|Set|Callable|Iterable)['"] from ['"]collections['"][^\r\n]*/i,
  );
  const tracebackPaths = [
    ...[...output.matchAll(/File\s+["']([^"']+\.py)["']/gi)].map((match) => match[1]),
    ...output.split(/\r?\n/).flatMap((line) => {
      const compact = line.match(/^\s*(?:E\s+)?(.+?\.py):\d+(?::|\s)/i)?.[1];
      return compact ? [compact.trim()] : [];
    }),
  ].map((value) => value.replace(/\\/g, "/").toLowerCase());
  const normalizedChanges = changedPaths
    .filter((value) => value && !value.startsWith("<"))
    .map((value) => value.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase());
  const failureTouchesMutation = tracebackPaths.some((tracebackPath) => normalizedChanges.some(
    (changedPath) => tracebackPath === changedPath || tracebackPath.endsWith(`/${changedPath}`),
  ));
  if (removedCollectionsImport && tracebackPaths.length > 0 && !failureTouchesMutation) {
    return `当前 Python 运行时与项目依赖不兼容：${removedCollectionsImport[0]}`;
  }
  return null;
}

/**
 * After write/patch/bash tools: staged verification or advisory.
 * Mutates nothing except via recovery controller / event bus / emit callbacks.
 * Caller applies recover/pause side effects on messages and attempt status.
 */
export async function runWriteToolVerification(
  preparedCalls: PreparedToolCall[],
  deps: WriteVerificationDeps
): Promise<WriteVerificationOutcome> {
  const mutationObservations = deps.observations?.filter((item) => Boolean(item.mutation)) ?? [];
  const hasWrites = deps.observations
    ? mutationObservations.length > 0
    : preparedCalls.some((t) => t.call.name === "write" || t.call.name === "patch" || t.call.name === "bash");
  if (!hasWrites) return { kind: "noop" };

  let stages = resolveVerificationStages({
    configuredCommand: deps.verificationCommand,
  });
  let projectRuntime: "native" | "wsl" | undefined;
  let projectCommand: Awaited<ReturnType<typeof resolveScopedVerificationCommand>>;
  if (stages.length === 0 && deps.projectProfile && deps.workspaceDir) {
    const changedPaths = mutationObservations.flatMap((item) => item.changedPaths ?? []);
    const candidates = deps.projectProfile.testCommands
      .filter((item) => item.stage === "syntax" || item.stage === "targeted");
    for (const candidate of candidates) {
      const scoped = await resolveScopedVerificationCommand({
        profile: deps.projectProfile,
        workspaceDir: deps.workspaceDir,
        commandId: candidate.id,
        changedPaths,
        requireNarrowScope: true,
      });
      if (!scoped) continue;
      stages = [{ name: scoped.stage === "syntax" ? "syntax_type" : "affected_tests", command: scoped.command }];
      projectCommand = scoped;
      projectRuntime = deps.projectProfile.runtime;
      break;
    }
  }
  if (stages.length === 0) {
    if (deps.projectProfile?.environmentStatus === "degraded" && deps.projectProfile.blockers.length > 0) {
      return {
        kind: "audit",
        text: [
          "验证环境未就绪；不要重复执行不可用 verifier，也不要直接宣告完成。",
          ...deps.projectProfile.blockers.map((blocker) => `- ${blocker}`),
          "先进行一次受限的 post-mutation audit，并逐条建立证据清单：",
          "1. 将用户或 issue 的每项要求映射到具体修改；不得只验证最先发现的症状。",
          "2. 从修改点追踪下游消费与调用路径，检查大小写、归一化、解析、转换和序列化等后续语义。",
          "3. 至少检查一个正向样例、一个反例或负向输入，以及未修改路径的兼容性。",
          "重新读取 diff 与相关实现；发现遗漏就直接修正。完成审计后仍无确定性 verifier 时，任务会保留补丁并暂停等待外部 grader。",
        ].join("\n"),
      };
    }
    await runAdvisoryVerification({
      messages: deps.messages,
      verifier: deps.verifier,
      emit: deps.emit,
    });
    return { kind: "advisory" };
  }

  const beforeIdentity = deps.workspaceDir ? await resolveProjectProfileIdentity(deps.workspaceDir) : null;
  const stagedVerifier = new StagedVerifier({ execute: async (command) => {
    const result = projectCommand?.executable
      ? await runManagedCommand({ executable: projectCommand.executable, args: projectCommand.args, command, cwd: deps.workspaceDir!, runtime: projectRuntime, env: buildSafeEnv([], {}), timeoutMs: 600_000 })
      : await deps.runCommand(command, projectRuntime);
    return result.timedOut || result.terminationConfirmed === false
      ? { ...result, code: 1, stderr: `${result.stderr}\nverification process tree outcome is unknown` }
      : result;
  } });
  const verification = await stagedVerifier.run(stages);
  const afterIdentity = deps.workspaceDir ? await resolveProjectProfileIdentity(deps.workspaceDir) : null;
  const workspaceStable = Boolean(
    beforeIdentity
      && afterIdentity
      && beforeIdentity.revision === afterIdentity.revision
      && beforeIdentity.dirtyFingerprint === afterIdentity.dirtyFingerprint
  );
  if (beforeIdentity && afterIdentity && !workspaceStable) {
    return {
      kind: "recover",
      userMessage: "验证命令修改了工作区，验证结果已作废。请检查新增副作用后重新验证。",
      strategy: "workspace_changed_during_verification",
      strategyAttempts: 1,
      failureMessage: "verification changed workspace",
    };
  }
  if (verification.ok) {
    const summary = formatVerificationStagesSummary(stages);
    deps.emit("verification", "PASS", `验证通过: ${summary}`);
    return { kind: "pass", summary, verificationBaseFingerprint: `${beforeIdentity!.revision}:${beforeIdentity!.dirtyFingerprint}`, workspaceFingerprint: `${afterIdentity!.revision}:${afterIdentity!.dirtyFingerprint}` };
  }


  const environmentBlocker = verificationEnvironmentBlocker(
    verification.stdout,
    verification.stderr,
    mutationObservations.flatMap((item) => item.changedPaths ?? []),
  );
  if (environmentBlocker) {
    deps.emit("verification", "BLOCKED", environmentBlocker);
    return {
      kind: "pause",
      text: [
        "验证环境未就绪；修改已保留为可恢复状态，未将运行时不兼容误判为实现失败。",
        `- ${environmentBlocker}`,
        "请使用项目支持的 Python 运行时或外部确定性 grader 复验该补丁。",
      ].join("\n"),
    };
  }

  const failedCommand =
    stages.find((stage) => stage.name === verification.failedStage)?.command ??
    stages.map((stage) => stage.command).join(" && ");
  const failure = classifyFailure(new Error(`verification command failed: ${failedCommand}`), {
    tool: "verify",
    verificationCommand: failedCommand,
  });
  const progress = await buildVerificationProgress(verification.failingTests, deps.runCommand);
  const decision = deps.recoveryController.recordFailure(failure, progress);
  const state = deps.recoveryController.getRecoveryState();
  const progressWithStrategy: ProgressSnapshot = {
    ...progress,
    attemptedStrategies: state.attemptedStrategies,
    currentStrategy: state.currentStrategy,
  };

  deps.executionEventBus.emit({
    runId: state.runId,
    sessionId: state.sessionId,
    type: "verification_failed",
    status: decision.action === "pause" ? "paused" : "recovering",
    stage: verification.failedStage,
    tool: "verify",
    category: decision.category,
    fingerprint: failure.fingerprint,
    progress: progressWithStrategy,
    recoveryAction: decision.recommendedStrategy ?? decision.action,
  });

  if (decision.action === "pause") {
    deps.executionEventBus.completeAttempt(deps.runId, "failed");
    deps.emit("recovery_paused", state, decision);
    return {
      kind: "pause",
      text: formatRecoveryPause({
        reason: verification.stderr || verification.stdout,
        next: decision.reason,
        state,
        verificationStagesSummary: formatVerificationStagesSummary(stages),
      }),
    };
  }

  const strategy = decision.recommendedStrategy ?? "targeted_verification_repair";
  const instruction = formatRecoveryInstruction(failure, strategy);
  const userMessage = buildVerificationFailureUserMessage({
    failedStage: verification.failedStage,
    failedCommand,
    failingTests: verification.failingTests,
    changedFiles: progress.changedFiles ?? [],
    fingerprint: failure.fingerprint,
    attemptedStrategies: state.attemptedStrategies,
    strategy,
    stdout: verification.stdout.slice(-2_000),
    stderr: verification.stderr.slice(-2_000),
    instructionBody: instruction.split("\n").slice(1).join("\n"),
  });

  return {
    kind: "recover",
    userMessage,
    strategy,
    strategyAttempts: state.strategyAttempts,
    failureMessage: failure.message,
  };
}

export function stagesSummary(verificationCommand: string | null): string {
  return formatVerificationStagesSummary(
    resolveVerificationStages({ configuredCommand: verificationCommand })
  );
}
