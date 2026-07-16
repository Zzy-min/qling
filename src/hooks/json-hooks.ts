import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { HookManager } from "../pipeline/hooks.js";
import type { HookResult, ToolHookContext, ToolResult } from "../types.js";

export type JsonHookEvent =
  | "SessionStart"
  | "SessionEnd"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure";

export interface JsonHookCommand {
  command: string;
  args?: string[];
}

export interface JsonHookManifest {
  version?: 1;
  events?: Partial<Record<JsonHookEvent, JsonHookCommand[]>>;
}

interface CommandOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

function byteLimited(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) return text;
  return buffer.subarray(0, maxBytes).toString("utf8");
}

export class JsonHookRunner {
  constructor(
    private readonly manifest: JsonHookManifest,
    private readonly options: {
      workspaceDir: string;
      auditPath: string;
      timeoutMs: number;
      maxOutputBytes: number;
    }
  ) {}

  async runPre(context: ToolHookContext): Promise<HookResult> {
    const outcomes = await this.runEvent("PreToolUse", { context });
    for (const outcome of outcomes) {
      if (!outcome.ok) {
        return {
          decision: "ask",
          additionalContexts: ["JSON PreToolUse hook failed; explicit approval is required."],
        };
      }
      if (!outcome.stdout.trim()) continue;
      try {
        const parsed = JSON.parse(outcome.stdout) as HookResult;
        if (parsed.decision === "allow" || parsed.decision === "ask" || parsed.decision === "deny") {
          return parsed;
        }
      } catch {
        return {
          decision: "ask",
          additionalContexts: ["JSON PreToolUse hook returned invalid JSON; explicit approval is required."],
        };
      }
    }
    return { decision: "allow" };
  }

  async runPost(context: ToolHookContext, result: ToolResult): Promise<void> {
    await this.runEvent("PostToolUse", { context, result: safeResult(result) });
  }

  async runFailure(context: ToolHookContext, error: Error): Promise<void> {
    await this.runEvent("PostToolUseFailure", { context, error: { message: error.message } });
  }

  async sessionStart(payload: { sessionId: string; workspace: string }): Promise<void> {
    await this.runEvent("SessionStart", payload);
  }

  async sessionEnd(payload: { sessionId: string; status: string }): Promise<void> {
    await this.runEvent("SessionEnd", payload);
  }

  private async runEvent(event: JsonHookEvent, payload: unknown): Promise<CommandOutcome[]> {
    const commands = this.manifest.events?.[event] ?? [];
    const outcomes: CommandOutcome[] = [];
    for (const command of commands) {
      const outcome = await runCommand(command, payload, this.options);
      outcomes.push(outcome);
      await this.audit(event, command.command, outcome);
    }
    return outcomes;
  }

  private async audit(event: JsonHookEvent, command: string, outcome: CommandOutcome): Promise<void> {
    await mkdir(path.dirname(this.options.auditPath), { recursive: true });
    const record = {
      timestamp: new Date().toISOString(),
      event,
      command: path.basename(command),
      ok: outcome.ok,
      code: outcome.code,
      timedOut: outcome.timedOut,
    };
    await appendFile(this.options.auditPath, JSON.stringify(record) + "\n", "utf8");
  }
}

function safeResult(result: ToolResult): Pick<ToolResult, "tool_call_id" | "is_error" | "error" | "meta"> {
  return {
    tool_call_id: result.tool_call_id,
    is_error: result.is_error,
    error: result.error,
    meta: result.meta,
  };
}

async function runCommand(
  entry: JsonHookCommand,
  payload: unknown,
  options: { workspaceDir: string; timeoutMs: number; maxOutputBytes: number }
): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    if (!entry?.command || typeof entry.command !== "string") {
      resolve({ ok: false, stdout: "", stderr: "invalid command", code: null, timedOut: false });
      return;
    }
    const child = spawn(entry.command, Array.isArray(entry.args) ? entry.args.map(String) : [], {
      cwd: options.workspaceDir,
      env: { ...process.env, QLING_HOOK_EVENT: "1" },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = byteLimited(stdout + chunk.toString("utf8"), options.maxOutputBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = byteLimited(stderr + chunk.toString("utf8"), options.maxOutputBytes);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: error.message, code: null, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: !timedOut && code === 0, stdout, stderr, code, timedOut });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export async function installJsonHooks(options: {
  hookManager: HookManager;
  stateDir: string;
  workspaceDir: string;
  sessionId: string;
}): Promise<JsonHookRunner | null> {
  if (process.env.QLING_JSON_HOOKS_ENABLED !== "true") return null;
  const manifestPath = path.resolve(
    process.env.QLING_JSON_HOOKS_MANIFEST ?? path.join(options.stateDir, "hooks.json")
  );
  let manifest: JsonHookManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as JsonHookManifest;
  } catch (error) {
    console.error(`[Hooks] JSON lifecycle disabled: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const runner = new JsonHookRunner(manifest, {
    workspaceDir: options.workspaceDir,
    auditPath: path.join(options.stateDir, "hooks", "events.jsonl"),
    timeoutMs: Math.max(100, Number(process.env.QLING_JSON_HOOKS_TIMEOUT_MS) || 5000),
    maxOutputBytes: Math.max(1024, Number(process.env.QLING_JSON_HOOKS_MAX_OUTPUT_BYTES) || 16 * 1024),
  });
  options.hookManager.register("PreToolUse", (context) => runner.runPre(context));
  options.hookManager.register("PostToolUse", (context, result) => runner.runPost(context, result));
  options.hookManager.register("PostToolUseFailure", (context, error) => runner.runFailure(context, error));
  await runner.sessionStart({
    sessionId: options.sessionId,
    workspace: path.basename(options.workspaceDir),
  });
  return runner;
}
