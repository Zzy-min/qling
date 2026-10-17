import { createHash } from "node:crypto";
import type { ToolDefinition, ToolResult } from "../types.js";
import { ContentAddressedArtifactStore } from "../harness/artifact-store.js";
import { getRuntimeRootsFromEnv } from "../runtime-paths.js";
import { inspectProjectProfileCached, resolveProjectProfileIdentity, resolveScopedVerificationCommand } from "../runtime/project-profile.js";
import { buildSafeEnv } from "./bash.js";
import { toolError } from "./error-utils.js";
import { normalizeEvidenceOutput } from "../agent/run-efficiency.js";
import { runManagedCommand } from "../execution/managed-command.js";

export interface VerificationRequest {
  verifierId: string;
  mutationId?: string;
  commandId: string;
  scope?: string[];
  outputView?: { mode: "full" | "head" | "tail"; lines?: number };
}

export const verifyTool: ToolDefinition = {
  name: "verify",
  description: "Run a deterministic ProjectProfile command by id. Output head/tail is a display option, not a shell pipeline.",
  parameters: { type: "object", properties: { verifierId: { type: "string" }, mutationId: { type: "string" }, commandId: { type: "string" }, scope: { type: "array", items: { type: "string" } }, outputView: { type: "object" } }, required: ["verifierId", "commandId"] },
  readOnly: false,
  destructive: false,
  concurrencySafe: false,
  scenes: ["coding", "verification"],
  priority: 10,
  effortHint: "medium",
};

function joinCommandOutput(stdout: string, stderr: string): string {
  if (!stdout && !stderr) return "(no output)";
  if (!stdout) return stderr;
  if (!stderr) return stdout;
  return stdout.endsWith("\n") || stdout.endsWith("\r\n") ? stdout + stderr : `${stdout}\n${stderr}`;
}

function viewOutput(output: string, view: VerificationRequest["outputView"]): string {
  const normalized = output.replace(/\r\n/g, "\n").replace(/\n$/, "");
  if (!view || view.mode === "full") return normalized;
  // npm 12 prints `npm notice run <script>` on stderr. Those lines echo the
  // command text and would otherwise crowd the head/tail view. The stored
  // artifact keeps the raw output, including any notice lines.
  const lines = normalized.split("\n").filter((line) => !/^npm notice\b/.test(line));
  const count = Math.max(1, Math.min(500, Math.floor(view.lines ?? 20)));
  return (view.mode === "head" ? lines.slice(0, count) : lines.slice(-count)).join("\n");
}

export async function runVerify(args: VerificationRequest): Promise<ToolResult> {
  const roots = getRuntimeRootsFromEnv();
  const workspaceDir = roots.workspaceDir ?? process.cwd();
  const profile = await inspectProjectProfileCached({ workspaceDir, requestedRuntime: (process.env.QLING_CODE_RUNTIME as "auto" | "native" | "wsl" | undefined) ?? "auto" });
  const registered = await resolveScopedVerificationCommand({
    profile,
    workspaceDir,
    commandId: String(args.commandId ?? ""),
    changedPaths: args.scope,
    requireNarrowScope: Boolean(args.scope?.length),
  });
  if (!registered) return toolError("VERIFY_COMMAND_NOT_REGISTERED", `unknown verification commandId: ${args.commandId}`);
  const timeoutMs = Math.max(1_000, Number(process.env.QLING_VERIFY_TIMEOUT_MS ?? 600_000));
  const beforeIdentity = await resolveProjectProfileIdentity(workspaceDir);
  const result = await runManagedCommand({ command: registered.command, executable: registered.executable, args: registered.args, cwd: workspaceDir, runtime: profile.runtime, env: buildSafeEnv([], {}), timeoutMs });
  const afterIdentity = await resolveProjectProfileIdentity(workspaceDir);
  const workspaceStable = beforeIdentity.revision === afterIdentity.revision && beforeIdentity.dirtyFingerprint === afterIdentity.dirtyFingerprint;
  const fullOutput = joinCommandOutput(result.stdout, result.stderr);
  const artifact = await new ContentAddressedArtifactStore(roots.fileStateDir).put(fullOutput);
  const verdict = result.timedOut || !result.terminationConfirmed || !workspaceStable ? "blocked" : result.code === 0 ? "pass" : "fail";
  const fingerprint = createHash("sha256").update(`${verdict}\0${normalizeEvidenceOutput(fullOutput)}`).digest("hex");
  return {
    tool_call_id: "",
    output: viewOutput(fullOutput, args.outputView),
    is_error: verdict !== "pass",
    ...(verdict === "pass" ? {} : { error: { code: result.timedOut ? "VERIFY_TIMEOUT" : !result.terminationConfirmed ? "VERIFY_UNKNOWN_OUTCOME" : !workspaceStable ? "VERIFY_MUTATED_WORKSPACE" : "VERIFY_FAILED", message: result.timedOut ? "verification timed out" : !result.terminationConfirmed ? "verification process tree termination could not be confirmed" : !workspaceStable ? "verification changed the workspace; result is not fresh" : `verification exited with code ${result.code}`, category: "validation" as const } }),
    meta: { verdict, exitCode: result.code, normalizedFingerprint: fingerprint, artifactRef: artifact.hash, artifactPath: artifact.path, verifierId: args.commandId, mutationId: args.mutationId, commandId: args.commandId, verificationBaseFingerprint: `${beforeIdentity.revision}:${beforeIdentity.dirtyFingerprint}`, workspaceFingerprint: `${afterIdentity.revision}:${afterIdentity.dirtyFingerprint}`, ...(registered.scope ? { scope: registered.scope } : {}) },
  };
}
