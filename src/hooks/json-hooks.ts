import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { HookManager } from "../pipeline/hooks.js";
import type { HookResult, ToolHookContext, ToolResult } from "../types.js";
import { readDisabledHookNames } from "./disabled-hooks.js";

export type JsonHookEvent =
  | "SessionStart"
  | "SessionEnd"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "SubagentStart"
  | "SubagentStop"
  | "Stop";

const TOOL_EVENTS = new Set<JsonHookEvent>(["PreToolUse", "PostToolUse", "PostToolUseFailure"]);
const DEFAULT_MAX_PAYLOAD_BYTES = 128 * 1024;
const MAX_STOP_FEEDBACK_CHARS = 10_000;

export interface JsonHookCommand {
  command: string;
  args?: string[];
  name?: string;
  /**
   * Tool events only. PreToolUse compile failure or a matcher without a tool
   * name fails closed (ask). Observe-only events disable that entry instead.
   */
  matcher?: string;
  enabled?: boolean;
  timeoutMs?: number;
}

export interface JsonHookManifest {
  version?: 1;
  events?: Partial<Record<JsonHookEvent, JsonHookCommand[]>>;
}

export interface StopHookInput {
  lastAssistantText: string;
  stopHookActive: boolean;
}

export interface StopHookDecision {
  blocked: boolean;
  reason?: string;
}

interface CommandOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  /** True when stdin JSON was shortened to the payload byte cap. */
  payloadTruncated?: boolean;
}

interface PreparedCommand {
  entry: JsonHookCommand;
  matcher?: RegExp;
  skipReason?: string;
}

export function jsonHooksMaxPayloadBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.QLING_JSON_HOOKS_MAX_PAYLOAD_BYTES);
  if (!Number.isFinite(raw) || raw < 64) return DEFAULT_MAX_PAYLOAD_BYTES;
  return Math.floor(raw);
}

export function stopHookMaxContinuations(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.QLING_STOP_HOOK_MAX_CONTINUATIONS;
  if (raw === undefined || String(raw).trim() === "") return 8;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 8;
  return Math.floor(value);
}

function byteLimited(text: string, maxBytes: number): string {
  return utf8Prefix(text, maxBytes);
}

function utf8Prefix(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  let bytes = 0;
  let end = 0;
  for (const ch of text) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += ch.length;
  }
  return text.slice(0, end);
}

const TRUNCATION_MARK = "…[truncated]";
const PROTECTED_PAYLOAD_PATHS = new Set([
  "hook_event_name",
  "tool_name",
  "context.toolName",
  "context.toolCallId",
  "context.sessionId",
]);

interface StringLeaf {
  path: string;
  bytes: number;
  value: string;
  protected: boolean;
  assign: (next: string) => void;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function payloadLimit(maxBytes: number): number {
  if (!Number.isFinite(maxBytes)) return 64;
  return Math.max(64, Math.floor(maxBytes));
}

function isProtectedPayloadPath(path: string): boolean {
  return PROTECTED_PAYLOAD_PATHS.has(path);
}

function withHookIdentity(event: JsonHookEvent, payload: unknown): unknown {
  const base: Record<string, unknown> =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>) }
      : { value: payload ?? null };
  if (typeof base.hook_event_name !== "string" || base.hook_event_name.trim() === "") {
    base.hook_event_name = event;
  }
  if (typeof base.tool_name !== "string" || base.tool_name.trim() === "") {
    const name = toolNameOf(base);
    if (name) base.tool_name = name;
  }
  return base;
}

function readPayloadIdentity(payload: unknown): { hookEvent?: string; toolName?: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const record = payload as Record<string, unknown>;
  const hookEvent = typeof record.hook_event_name === "string" ? record.hook_event_name : undefined;
  let toolName = typeof record.tool_name === "string" ? record.tool_name : undefined;
  if (toolName === undefined) {
    const context = record.context;
    if (context && typeof context === "object" && !Array.isArray(context)) {
      const name = (context as Record<string, unknown>).toolName;
      if (typeof name === "string") toolName = name;
    }
  }
  return { hookEvent, toolName };
}

function collectStringLeaves(value: unknown, path: string, out: StringLeaf[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStringLeaves(item, `${path}[${index}]`, out));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (typeof child === "string") {
      out.push({
        path: childPath,
        bytes: byteLength(child),
        value: child,
        protected: isProtectedPayloadPath(childPath),
        assign: (next: string) => {
          (value as Record<string, unknown>)[key] = next;
        },
      });
      continue;
    }
    collectStringLeaves(child, childPath, out);
  }
}

function shrinkLeaf(leaf: StringLeaf, overflow: number, extra: number): void {
  const markBytes = byteLength(TRUNCATION_MARK);
  const budget = Math.max(0, leaf.bytes - overflow - extra - markBytes - 8);
  let next = "";
  if (budget > 0) {
    if (budget <= markBytes) next = utf8Prefix(leaf.value, budget);
    else next = utf8Prefix(leaf.value, budget - markBytes) + TRUNCATION_MARK;
  }
  if (byteLength(next) >= leaf.bytes) {
    next = leaf.bytes <= 1 ? "" : utf8Prefix(leaf.value, Math.max(0, Math.floor(leaf.bytes / 2)));
    if (byteLength(next) >= leaf.bytes) next = "";
  }
  leaf.assign(next);
}

function shrinkLargestString(
  working: Record<string, unknown>,
  truncatedFields: string[],
  overflow: number,
  allowProtected: boolean,
): boolean {
  const leaves: StringLeaf[] = [];
  collectStringLeaves(working, "", leaves);
  const candidates = leaves.filter((leaf) => leaf.bytes > 0 && (allowProtected || !leaf.protected));
  if (candidates.length === 0) return false;
  candidates.sort((a, b) => b.bytes - a.bytes);
  const target = candidates[0];
  if (!target) return false;
  const extra = truncatedFields.includes(target.path) ? 0 : byteLength(JSON.stringify(target.path)) + 1;
  shrinkLeaf(target, overflow, extra);
  if (!truncatedFields.includes(target.path)) truncatedFields.push(target.path);
  return true;
}

function dropLargestUnprotected(working: Record<string, unknown>, truncatedFields: string[]): boolean {
  const candidates: Array<{ bytes: number; path: string; remove: () => void }> = [];
  const visit = (container: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(container)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (path === "truncated" || path === "truncatedFields" || isProtectedPayloadPath(path)) continue;
      if (path === "context" && value && typeof value === "object" && !Array.isArray(value)) {
        visit(value as Record<string, unknown>, "context");
        continue;
      }
      let bytes = 0;
      try {
        bytes = byteLength(JSON.stringify(value));
      } catch {
        bytes = Number.MAX_SAFE_INTEGER;
      }
      candidates.push({
        bytes,
        path,
        remove: () => {
          delete container[key];
        },
      });
    }
  };
  visit(working, "");
  candidates.sort((a, b) => b.bytes - a.bytes);
  const target = candidates.find((candidate) => candidate.bytes > 0);
  if (!target) return false;
  target.remove();
  if (!truncatedFields.includes(target.path)) truncatedFields.push(target.path);
  return true;
}

function previewFallback(
  identity: { hookEvent?: string; toolName?: string },
  full: string,
  limit: number,
): string {
  let hookEvent = identity.hookEvent;
  let toolName = identity.toolName;
  let preview = utf8Prefix(full, limit);
  const build = (includePreview: boolean) => {
    const body: Record<string, unknown> = { truncated: true };
    if (hookEvent !== undefined) body.hook_event_name = hookEvent;
    if (toolName !== undefined) body.tool_name = toolName;
    if (includePreview) body.preview = preview;
    return JSON.stringify(body);
  };
  let encoded = build(true);
  while (byteLength(encoded) > limit && preview.length > 0) {
    const step = Math.max(1, Math.ceil(preview.length / 8));
    preview = utf8Prefix(preview.slice(0, Math.max(0, preview.length - step)), limit);
    encoded = build(true);
  }
  if (byteLength(encoded) > limit) {
    preview = "";
    encoded = build(false);
  }
  const shrinkIdentity = () => {
    const eventBytes = hookEvent ? byteLength(hookEvent) : 0;
    const toolBytes = toolName ? byteLength(toolName) : 0;
    if (toolBytes >= eventBytes && toolName) {
      const step = Math.max(1, Math.ceil(toolBytes / 8));
      toolName = utf8Prefix(toolName, Math.max(0, toolBytes - step));
      return;
    }
    if (hookEvent) {
      const step = Math.max(1, Math.ceil(Math.max(1, eventBytes) / 8));
      hookEvent = utf8Prefix(hookEvent, Math.max(0, eventBytes - step));
    }
  };
  while (byteLength(encoded) > limit && ((hookEvent?.length ?? 0) > 0 || (toolName?.length ?? 0) > 0)) {
    shrinkIdentity();
    encoded = build(false);
  }
  if (byteLength(encoded) <= limit) return encoded;
  const bare = JSON.stringify({ truncated: true, preview: "" });
  if (byteLength(bare) <= limit) return bare;
  return utf8Prefix(bare, limit);
}

function encodeHookPayloadDetailed(payload: unknown, maxBytes: number): { encoded: string; truncated: boolean } {
  const limit = payloadLimit(maxBytes);
  let full: string;
  try {
    full = JSON.stringify(payload ?? null);
  } catch {
    return { encoded: previewFallback({}, "null", limit), truncated: true };
  }
  if (byteLength(full) <= limit) return { encoded: full, truncated: false };

  const identity = readPayloadIdentity(payload);
  let working: Record<string, unknown>;
  try {
    const cloned = JSON.parse(full) as unknown;
    working = cloned && typeof cloned === "object" && !Array.isArray(cloned)
      ? cloned as Record<string, unknown>
      : { value: cloned };
  } catch {
    return { encoded: previewFallback(identity, full, limit), truncated: true };
  }

  const truncatedFields: string[] = [];
  const materialize = (includeFields: boolean): string => {
    const body: Record<string, unknown> = { ...working, truncated: true };
    if (includeFields) body.truncatedFields = truncatedFields;
    return JSON.stringify(body);
  };

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const encoded = materialize(true);
    const overflow = byteLength(encoded) - limit;
    if (overflow <= 0) return { encoded, truncated: true };
    if (!shrinkLargestString(working, truncatedFields, overflow, false)) break;
  }
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const encoded = materialize(true);
    if (byteLength(encoded) <= limit) return { encoded, truncated: true };
    if (!dropLargestUnprotected(working, truncatedFields)) break;
  }

  // Short identity fields (hook_event_name, tool_name, context.toolName, …)
  // are never blanked to make a structural payload fit. If they alone cannot
  // fit, the preview fallback keeps those keys and shortens only as needed.
  const withFields = materialize(true);
  if (byteLength(withFields) <= limit) return { encoded: withFields, truncated: true };
  const withoutFields = materialize(false);
  if (byteLength(withoutFields) <= limit) return { encoded: withoutFields, truncated: true };
  return { encoded: previewFallback(identity, full, limit), truncated: true };
}

export function encodeHookPayload(payload: unknown, maxBytes: number): string {
  return encodeHookPayloadDetailed(payload, maxBytes).encoded;
}

function hookName(entry: JsonHookCommand | undefined): string {
  return typeof entry?.name === "string" ? entry.name.trim() : "";
}

function decisionRank(decision: string | undefined): number {
  if (decision === "deny") return 3;
  if (decision === "ask") return 2;
  return 1;
}

/** deny beats ask beats allow. Equal rank keeps the earlier result. */
function strictestPreDecision(results: HookResult[]): HookResult {
  let best: HookResult = { decision: "allow" };
  for (const result of results) {
    if (decisionRank(result.decision) > decisionRank(best.decision)) best = result;
  }
  return best;
}

function prepareCommand(
  entry: JsonHookCommand,
  event: JsonHookEvent,
  disabledNames: ReadonlySet<string>
): PreparedCommand {
  if (entry?.enabled === false) return { entry, skipReason: "disabled" };
  const name = hookName(entry);
  if (name && disabledNames.has(name)) return { entry, skipReason: "user_disabled" };
  if (TOOL_EVENTS.has(event) && typeof entry?.matcher === "string" && entry.matcher.trim()) {
    try {
      return { entry, matcher: new RegExp(entry.matcher) };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { entry, skipReason: `matcher_compile_failed: ${detail}` };
    }
  }
  return { entry };
}

function toolNameOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const context = (payload as { context?: { toolName?: unknown } }).context;
  if (!context || typeof context.toolName !== "string") return null;
  const name = context.toolName.trim();
  return name ? name : null;
}

function matcherAllows(matcher: RegExp, toolName: string | null): boolean {
  if (!toolName) return false;
  try {
    matcher.lastIndex = 0;
    return matcher.test(toolName);
  } catch {
    return false;
  }
}

export class JsonHookRunner {
  private readonly disabledNames: ReadonlySet<string>;
  private readonly maxPayloadBytes: number;
  private readonly auditedSkips = new Set<string>();

  constructor(
    private readonly manifest: JsonHookManifest,
    private readonly options: {
      workspaceDir: string;
      auditPath: string;
      timeoutMs: number;
      maxOutputBytes: number;
      disabledNames?: ReadonlySet<string>;
      maxPayloadBytes?: number;
    }
  ) {
    this.disabledNames = options.disabledNames ?? new Set();
    this.maxPayloadBytes = options.maxPayloadBytes ?? jsonHooksMaxPayloadBytes();
  }

  async runPre(context: ToolHookContext): Promise<HookResult> {
    const ran = await this.runEvent("PreToolUse", { context });
    const ranked: HookResult[] = [];
    if (ran.preFloor) ranked.push(ran.preFloor);
    for (const outcome of ran.outcomes) {
      if (!outcome.ok) {
        ranked.push({
          decision: "ask",
          additionalContexts: ["JSON PreToolUse hook failed; explicit approval is required."],
        });
        continue;
      }
      if (!outcome.stdout.trim()) continue;
      try {
        const parsed = JSON.parse(outcome.stdout) as HookResult;
        if (parsed.decision === "allow" || parsed.decision === "ask" || parsed.decision === "deny") {
          ranked.push(parsed);
        }
      } catch {
        ranked.push({
          decision: "ask",
          additionalContexts: ["JSON PreToolUse hook returned invalid JSON; explicit approval is required."],
        });
      }
    }
    return strictestPreDecision(ranked);
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

  async subagentStart(payload: { role: string; task: string }): Promise<void> {
    await this.runEvent("SubagentStart", {
      role: payload.role,
      task: String(payload.task ?? "").slice(0, 200),
    });
  }

  async subagentStop(payload: {
    role: string;
    task: string;
    success: boolean;
    durationMs: number;
  }): Promise<void> {
    await this.runEvent("SubagentStop", {
      role: payload.role,
      task: String(payload.task ?? "").slice(0, 200),
      success: payload.success,
      durationMs: payload.durationMs,
    });
  }

  /**
   * Stop is fail-open: a crash, timeout, or invalid payload does not block
   * the turn from ending. Only an explicit decision=block continues the turn.
   */
  async runStop(input: StopHookInput): Promise<StopHookDecision> {
    const payload = {
      lastAssistantText: String(input.lastAssistantText ?? "").slice(0, 2000),
      stopHookActive: Boolean(input.stopHookActive),
    };
    let outcomes: CommandOutcome[] = [];
    try {
      outcomes = (await this.runEvent("Stop", payload)).outcomes;
    } catch {
      return { blocked: false };
    }
    for (const outcome of outcomes) {
      if (!outcome.ok || !outcome.stdout.trim()) continue;
      try {
        const parsed = JSON.parse(outcome.stdout) as { decision?: string; reason?: string };
        if (parsed.decision === "block") {
          return {
            blocked: true,
            reason: String(parsed.reason ?? "").slice(0, MAX_STOP_FEEDBACK_CHARS),
          };
        }
      } catch {
        // Invalid Stop output does not prevent the turn from ending.
      }
    }
    return { blocked: false };
  }

  private async runEvent(
    event: JsonHookEvent,
    payload: unknown
  ): Promise<{ outcomes: CommandOutcome[]; preFloor?: HookResult }> {
    const enriched = withHookIdentity(event, payload);
    const commands = this.manifest.events?.[event] ?? [];
    const outcomes: CommandOutcome[] = [];
    let preFloor: HookResult | undefined;
    const toolName = TOOL_EVENTS.has(event) ? toolNameOf(enriched) : null;
    const notePreFloor = (result: HookResult) => {
      if (!preFloor || decisionRank(result.decision) > decisionRank(preFloor.decision)) {
        preFloor = result;
      }
    };
    for (const command of commands) {
      let prepared: PreparedCommand;
      try {
        prepared = prepareCommand(command, event, this.disabledNames);
      } catch (error) {
        prepared = {
          entry: command,
          skipReason: `matcher_compile_failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (prepared.skipReason === "disabled" || prepared.skipReason === "user_disabled") {
        continue;
      }
      if (prepared.skipReason?.startsWith("matcher_compile_failed")) {
        await this.auditSkip(event, command, prepared.skipReason);
        if (event === "PreToolUse") {
          notePreFloor({
            decision: "ask",
            additionalContexts: [
              "JSON PreToolUse matcher failed to compile; explicit approval is required.",
            ],
          });
        }
        continue;
      }
      if (event === "PreToolUse" && prepared.matcher && !toolName) {
        await this.auditSkip(event, command, "matcher_missing_tool_name");
        notePreFloor({
          decision: "ask",
          additionalContexts: [
            "JSON PreToolUse matcher has no tool name; explicit approval is required.",
          ],
        });
        continue;
      }
      if (prepared.matcher && !matcherAllows(prepared.matcher, toolName)) continue;
      try {
        const outcome = await runCommand(prepared.entry, enriched, {
          ...this.options,
          maxPayloadBytes: this.maxPayloadBytes,
        });
        outcomes.push(outcome);
        if (event === "PreToolUse" && outcome.payloadTruncated) {
          notePreFloor({
            decision: "ask",
            additionalContexts: [
              "JSON PreToolUse payload was truncated; explicit approval is required.",
            ],
          });
        }
        await this.audit(event, command.command, outcome);
      } catch (error) {
        const outcome: CommandOutcome = {
          ok: false,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          code: null,
          timedOut: false,
        };
        outcomes.push(outcome);
        await this.audit(event, command?.command ?? "", outcome);
      }
    }
    return { outcomes, preFloor };
  }

  private async auditSkip(event: JsonHookEvent, command: JsonHookCommand, reason: string): Promise<void> {
    const key = `${event}:${hookName(command) || command?.command || "hook"}:${reason}`;
    if (this.auditedSkips.has(key)) return;
    this.auditedSkips.add(key);
    await this.audit(event, command?.command ?? "", {
      ok: false,
      stdout: "",
      stderr: reason,
      code: null,
      timedOut: false,
    }, { skipped: true, reason });
  }

  private async audit(
    event: JsonHookEvent,
    command: string,
    outcome: CommandOutcome,
    extra?: Record<string, unknown>
  ): Promise<void> {
    await mkdir(path.dirname(this.options.auditPath), { recursive: true });
    const record = {
      timestamp: new Date().toISOString(),
      event,
      command: path.basename(command || "hook"),
      ok: outcome.ok,
      code: outcome.code,
      timedOut: outcome.timedOut,
      ...extra,
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

function resolveTimeout(entry: JsonHookCommand, fallback: number): number {
  const value = Number(entry.timeoutMs);
  if (Number.isFinite(value) && value >= 50) return Math.floor(value);
  return fallback;
}

async function runCommand(
  entry: JsonHookCommand,
  payload: unknown,
  options: { workspaceDir: string; timeoutMs: number; maxOutputBytes: number; maxPayloadBytes: number }
): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    if (!entry?.command || typeof entry.command !== "string") {
      resolve({
        ok: false,
        stdout: "",
        stderr: "invalid command",
        code: null,
        timedOut: false,
        payloadTruncated: false,
      });
      return;
    }
    let encoded = "";
    let payloadTruncated = false;
    try {
      const detailed = encodeHookPayloadDetailed(payload, options.maxPayloadBytes);
      encoded = detailed.encoded;
      payloadTruncated = detailed.truncated;
    } catch (error) {
      resolve({
        ok: false,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        code: null,
        timedOut: false,
        payloadTruncated: true,
      });
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
    let settled = false;
    const finish = (outcome: CommandOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, resolveTimeout(entry, options.timeoutMs));
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = byteLimited(stdout + chunk.toString("utf8"), options.maxOutputBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = byteLimited(stderr + chunk.toString("utf8"), options.maxOutputBytes);
    });
    child.on("error", (error) => {
      finish({ ok: false, stdout, stderr: error.message, code: null, timedOut, payloadTruncated });
    });
    child.on("close", (code) => {
      finish({ ok: !timedOut && code === 0, stdout, stderr, code, timedOut, payloadTruncated });
    });
    try {
      child.stdin.end(encoded);
    } catch (error) {
      child.kill();
      finish({
        ok: false,
        stdout,
        stderr: error instanceof Error ? error.message : String(error),
        code: null,
        timedOut,
        payloadTruncated,
      });
    }
  });
}

export async function installJsonHooks(options: {
  hookManager: HookManager;
  stateDir: string;
  workspaceDir: string;
  sessionId: string;
  /** 子 agent 仍注册 Pre/PostToolUse，但不发 SessionStart。默认 true。 */
  emitSessionStart?: boolean;
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
  const disabledNames = await readDisabledHookNames(options.stateDir);
  const runner = new JsonHookRunner(manifest, {
    workspaceDir: options.workspaceDir,
    auditPath: path.join(options.stateDir, "hooks", "events.jsonl"),
    timeoutMs: Math.max(100, Number(process.env.QLING_JSON_HOOKS_TIMEOUT_MS) || 5000),
    maxOutputBytes: Math.max(1024, Number(process.env.QLING_JSON_HOOKS_MAX_OUTPUT_BYTES) || 16 * 1024),
    maxPayloadBytes: jsonHooksMaxPayloadBytes(),
    disabledNames,
  });
  options.hookManager.register("PreToolUse", (context) => runner.runPre(context));
  options.hookManager.register("PostToolUse", (context, result) => runner.runPost(context, result));
  options.hookManager.register("PostToolUseFailure", (context, error) => runner.runFailure(context, error));
  if (options.emitSessionStart !== false) {
    await runner.sessionStart({
      sessionId: options.sessionId,
      workspace: path.basename(options.workspaceDir),
    });
  }
  return runner;
}
