// ============================================================
// 写操作验证闭环（从 AgentLoop 抽出）
// StagedVerifier 驱动恢复；无 stage 时仅 advisory
// ============================================================

import { createHash } from "node:crypto";
import { exec } from "node:child_process";
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

export type ShellResult = { code: number; stdout: string; stderr: string };

export function runShellCommand(cmd: string, cwd: string): Promise<ShellResult> {
  return new Promise((resolve) => {
    exec(cmd, { cwd }, (error, stdout, stderr) => {
      const code = error ? ((error as { code?: number }).code ?? 1) : 0;
      resolve({ code, stdout, stderr });
    });
  });
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
  | { kind: "pass"; summary: string }
  | { kind: "advisory" }
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
  runCommand: (cmd: string) => Promise<ShellResult>;
  recoveryController: RecoveryController;
  executionEventBus: ExecutionEventBus;
  emit: (event: string, ...args: unknown[]) => void;
  getRecoveryState: () => RecoveryState | null;
  verifier: VerificationAgent;
  messages: Message[];
  runId: string;
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
  const hasWrites = preparedCalls.some(
    (t) => t.call.name === "write" || t.call.name === "patch" || t.call.name === "bash"
  );
  if (!hasWrites) return { kind: "noop" };

  const stages = resolveVerificationStages({
    configuredCommand: deps.verificationCommand,
  });
  if (stages.length === 0) {
    await runAdvisoryVerification({
      messages: deps.messages,
      verifier: deps.verifier,
      emit: deps.emit,
    });
    return { kind: "advisory" };
  }

  const stagedVerifier = new StagedVerifier({ execute: (command) => deps.runCommand(command) });
  const verification = await stagedVerifier.run(stages);
  if (verification.ok) {
    const summary = formatVerificationStagesSummary(stages);
    deps.emit("verification", "PASS", `验证通过: ${summary}`);
    return { kind: "pass", summary };
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
