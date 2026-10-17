import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { format } from "node:util";
import * as acp from "@agentclientprotocol/sdk";

import type { Channel } from "../channels/types.js";
import type { ApprovalRequest, ApprovalResponse } from "../types.js";
import type { ExecutionEvent } from "../execution/types.js";
import { summarizeToolOutputForContext } from "../context-tool-hygiene.js";
import {
  detectInterruptedRun,
  INTERRUPTED_RUN_KEY,
  INTERRUPTED_RUN_REMINDER,
} from "../session/interrupted-run.js";
import { getPackageVersion } from "../package-version.js";

export interface AcpRunOutcome {
  status: string;
  text: string;
  recovery?: unknown;
}

export interface AcpReplayMessage {
  role?: string;
  content?: unknown;
  tool_calls?: ReadonlyArray<{
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
  tool_call_id?: string;
  synthetic_key?: string;
}

export interface AcpAgentSession {
  waitForInit(): Promise<void>;
  getSessionId(): string;
  addUserMessage(content: string): void;
  run(): Promise<string>;
  runDetailed?(): Promise<AcpRunOutcome>;
  setChannel(channel: Channel): void;
  setPlanMode(enabled: boolean): void;
  setPermissionMode(mode: "allow" | "deny" | "ask"): void;
  subscribeExecutionEvents(listener: (event: ExecutionEvent) => void): () => void;
  cancelActiveRun(): boolean;
  shutdown(): Promise<void>;
  on?(event: string, handler: Function): unknown;
  off?(event: string, handler: Function): void;
  removeListener?(event: string, handler: Function): void;
  restoreSession?(id: string): Promise<unknown | null>;
  getMessagesSnapshot?(): readonly AcpReplayMessage[];
  getActiveRun?(): { runId: string; sessionId?: string } | null;
  getRecoveryState?(): { status?: string } | null;
  readRunTrace?(runId: string): Promise<ReadonlyArray<{ type?: string }>>;
}

export type AcpAgentFactory = (cwd: string) => AcpAgentSession | Promise<AcpAgentSession>;
type AcpModeId = "normal" | "plan" | "auto";

interface PromptTicket {
  cancelled: boolean;
}

interface QueuedPrompt extends PromptTicket {
  text: string;
  client: acp.AgentContext;
  resolve: (value: acp.PromptResponse) => void;
  reject: (error: unknown) => void;
}

interface ToolSlot {
  toolCallId: string;
  tool?: string;
  rawInput?: unknown;
  rawInputSeen: boolean;
  output?: string;
  outputSeen: boolean;
  failed: boolean;
}

interface ManagedAcpSession {
  id: string;
  agent: AcpAgentSession;
  modeId: AcpModeId;
  activePrompt: boolean;
  cancelRequested: boolean;
  client: acp.AgentContext | null;
  activeTicket: PromptTicket | null;
  queue: QueuedPrompt[];
  tools: Map<string, ToolSlot>;
  unsubscribers: Array<() => void>;
  pendingNotifications: Promise<void>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  batcher: AcpTextBatcher | null;
}

const MODES: acp.SessionMode[] = [
  { id: "normal", name: "Normal", description: "Execute with approval prompts for sensitive tools." },
  { id: "plan", name: "Plan", description: "Plan without making workspace changes." },
  { id: "auto", name: "Auto", description: "Execute tools without interactive approval prompts." },
];

const RAW_INPUT_LIMIT = 4096;
const TOOL_OUTPUT_LIMIT = 2048;
const TEXT_FLUSH_MS = 200;
const TEXT_FLUSH_BYTES = 1024;
const DEFAULT_MAX_QUEUED = 4;
const DEFAULT_IDLE_MS = 30 * 60 * 1000;
const SESSION_ID_MAX = 200;

function modeState(currentModeId: AcpModeId): acp.SessionModeState {
  return { currentModeId, availableModes: MODES };
}

function applyMode(agent: AcpAgentSession, modeId: AcpModeId): void {
  agent.setPlanMode(modeId === "plan");
  agent.setPermissionMode(modeId === "auto" ? "allow" : "ask");
}

function toolKind(tool: string | undefined): acp.ToolKind {
  const name = String(tool ?? "").toLowerCase();
  if (/read|view|inspect|status/.test(name)) return "read";
  if (/write|patch|edit/.test(name)) return "edit";
  if (/delete|remove/.test(name)) return "delete";
  if (/move|rename/.test(name)) return "move";
  if (/search|find|grep|glob/.test(name)) return "search";
  if (/fetch|http|web|browser/.test(name)) return "fetch";
  if (/think|reflect|plan/.test(name)) return "think";
  if (/bash|shell|command|exec|test/.test(name)) return "execute";
  return "other";
}

function promptText(blocks: acp.ContentBlock[]): string {
  const parts = blocks.map((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "resource_link") {
      const details = block.description?.trim() ? ` — ${block.description.trim()}` : "";
      return `[Resource: ${block.name}] ${block.uri}${details}`;
    }
    throw new Error(`ACP content type is not supported: ${block.type}`);
  });
  const text = parts.join("\n\n").trim();
  if (!text) throw new Error("ACP prompt must contain non-empty text or a resource link");
  return text;
}

async function validateCwd(cwd: string): Promise<string> {
  if (!path.isAbsolute(cwd)) {
    throw acp.RequestError.invalidParams(undefined, "ACP session cwd must be an absolute path");
  }
  const info = await stat(cwd).catch(() => null);
  if (!info?.isDirectory()) {
    throw acp.RequestError.invalidParams(undefined, "ACP session cwd must be an existing directory");
  }
  return path.resolve(cwd);
}

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function denied(requestId: string): ApprovalResponse {
  return { requestId, decision: "deny", timestamp: Date.now() };
}

function isCanceledError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "AgentRunCanceledError" || /aborted|cancell?ed/i.test(error.message));
}

function isSoftStop(outcome: AcpRunOutcome): boolean {
  return outcome.status === "paused" || outcome.status === "recovering" || outcome.status === "exhausted";
}

/** Reject path separators, parent segments, and absolute paths before any store lookup. */
export function validateAcpSessionId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0 || id.length > SESSION_ID_MAX || id !== id.trim()) {
    throw acp.RequestError.invalidParams(undefined, "ACP session id is invalid");
  }
  if (/[\u0000-\u001f\u007f]/.test(id) || hasUnsafeSessionId(id, 0)) {
    throw acp.RequestError.invalidParams(undefined, "ACP session id is invalid");
  }
  return id;
}

function hasUnsafeSessionId(id: string, depth: number): boolean {
  if (id === "." || id === ".." || id.includes("..")) return true;
  if (/[\\/]/.test(id)) return true;
  if (path.win32.isAbsolute(id) || path.posix.isAbsolute(id) || /^[a-zA-Z]:/.test(id)) return true;
  if (depth >= 2 || !id.includes("%")) return false;
  try {
    const decoded = decodeURIComponent(id);
    return decoded !== id && hasUnsafeSessionId(decoded, depth + 1);
  } catch {
    return true;
  }
}

export function truncateUtf8(text: string, limit: number): string {
  if (Buffer.byteLength(text, "utf8") <= limit) return text;
  const marker = "…[truncated]";
  const budget = Math.max(0, limit - Buffer.byteLength(marker, "utf8"));
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > budget) break;
    bytes += size;
    end += char.length;
  }
  const truncated = text.slice(0, end) + marker;
  return Buffer.byteLength(truncated, "utf8") <= limit ? truncated : truncated.slice(0, limit);
}

export function truncateRawInput(value: unknown): unknown {
  let json: string;
  try {
    const serialized = JSON.stringify(value);
    json = typeof serialized === "string" ? serialized : "null";
  } catch {
    json = JSON.stringify(String(value));
  }
  if (Buffer.byteLength(json, "utf8") <= RAW_INPUT_LIMIT) {
    try {
      return JSON.parse(json) as unknown;
    } catch {
      return json;
    }
  }
  return truncateUtf8(json, RAW_INPUT_LIMIT);
}

export function summarizeAcpToolOutput(output: string): string {
  const summary = summarizeToolOutputForContext(output, {
    maxChars: TOOL_OUTPUT_LIMIT,
    headChars: 1200,
    tailChars: 400,
  });
  return truncateUtf8(summary, TOOL_OUTPUT_LIMIT);
}

function normalizePlanStatus(status: unknown): acp.PlanEntryStatus {
  const value = String(status ?? "pending").toLowerCase();
  if (value === "completed" || value === "done" || value === "cancelled" || value === "canceled") return "completed";
  if (value === "in_progress" || value === "running" || value === "active") return "in_progress";
  return "pending";
}

function normalizePriority(priority: unknown): acp.PlanEntryPriority {
  const value = String(priority ?? "medium").toLowerCase();
  if (value === "high" || value === "low") return value;
  return "medium";
}

export function planEntriesFromUnknown(value: unknown): acp.PlanEntry[] | null {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { entries?: unknown }).entries)
      ? (value as { entries: unknown[] }).entries
      : value && typeof value === "object" && Array.isArray((value as { todos?: unknown }).todos)
        ? (value as { todos: unknown[] }).todos
        : null;
  if (!raw || raw.length === 0) return null;
  const entries: acp.PlanEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const record = item as { content?: unknown; text?: unknown; status?: unknown; priority?: unknown };
    const content = typeof record.content === "string"
      ? record.content
      : typeof record.text === "string"
        ? record.text
        : "";
    if (!content.trim()) return null;
    entries.push({
      content,
      priority: normalizePriority(record.priority),
      status: normalizePlanStatus(record.status),
    });
  }
  return entries;
}

function subscribeAgent(agent: AcpAgentSession, event: string, handler: (...args: unknown[]) => void): () => void {
  if (typeof agent.on !== "function") return () => {};
  const result = agent.on(event, handler as Function);
  if (typeof result === "function") return result as () => void;
  return () => {
    if (typeof agent.off === "function") agent.off(event, handler as Function);
    else if (typeof agent.removeListener === "function") agent.removeListener(event, handler as Function);
  };
}

class AcpTextBatcher {
  private buffer = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  sentAny = false;
  sentText = "";
  private closed = false;

  constructor(private send: (text: string) => Promise<void>) {}

  push(delta: string): void {
    if (this.closed || !delta) return;
    this.buffer += delta;
    if (Buffer.byteLength(this.buffer, "utf8") >= TEXT_FLUSH_BYTES) {
      this.enqueueFlush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.enqueueFlush();
      }, TEXT_FLUSH_MS);
    }
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.enqueueFlush();
    return this.chain;
  }

  dispose(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.buffer = "";
  }

  private enqueueFlush(): void {
    if (this.closed) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const text = this.buffer;
    if (!text) return;
    this.buffer = "";
    this.sentAny = true;
    this.sentText += text;
    this.chain = this.chain.then(() => this.send(text));
  }
}

class AcpApprovalChannel implements Channel {
  readonly name = "acp";
  constructor(private readonly session: ManagedAcpSession) {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async sendText(_text: string): Promise<void> {}
  async sendToolStart(_toolName: string, _args: Record<string, unknown>): Promise<void> {}
  async sendToolResult(_toolName: string, _output: string, _isError: boolean): Promise<void> {}
  async sendError(_text: string): Promise<void> {}
  onUserMessage(_handler: (msg: string) => Promise<void>): void {}

  async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
    const client = this.session.client;
    if (!client || this.session.cancelRequested || this.session.activeTicket?.cancelled) return denied(request.id);
    const response = await client.request(acp.methods.client.session.requestPermission, {
      sessionId: this.session.id,
      toolCall: {
        toolCallId: request.id,
        title: `${request.toolName}: ${request.reason}`,
        kind: toolKind(request.toolName),
        status: "pending",
        rawInput: truncateRawInput(request.arguments),
      },
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject_once", name: "Reject", kind: "reject_once" },
      ],
    }).catch(() => ({ outcome: { outcome: "cancelled" as const } }));
    return response.outcome.outcome === "selected" && response.outcome.optionId === "allow_once"
      ? { requestId: request.id, decision: "allow", timestamp: Date.now() }
      : denied(request.id);
  }
}

let stdoutGuardDepth = 0;
let stdoutGuardOriginal: {
  log: typeof console.log;
  info: typeof console.info;
  debug: typeof console.debug;
} | null = null;

function writeConsoleToStderr(...args: unknown[]): void {
  try {
    process.stderr.write(`${format(...(args as [unknown, ...unknown[]]))}\n`);
  } catch {
    // Never throw into the ACP stdout stream.
  }
}

/**
 * Redirect console.log/info/debug to stderr for the ACP process.
 * process.stdout itself is left alone so protocol frames keep flowing.
 * The returned function restores the previous console methods.
 */
export function installAcpStdoutGuard(): () => void {
  if (stdoutGuardDepth === 0) {
    stdoutGuardOriginal = {
      log: console.log,
      info: console.info,
      debug: console.debug,
    };
    console.log = writeConsoleToStderr as typeof console.log;
    console.info = writeConsoleToStderr as typeof console.info;
    console.debug = writeConsoleToStderr as typeof console.debug;
  }
  stdoutGuardDepth += 1;
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    stdoutGuardDepth = Math.max(0, stdoutGuardDepth - 1);
    if (stdoutGuardDepth === 0 && stdoutGuardOriginal) {
      console.log = stdoutGuardOriginal.log;
      console.info = stdoutGuardOriginal.info;
      console.debug = stdoutGuardOriginal.debug;
      stdoutGuardOriginal = null;
    }
  };
}

export class QlingAcpServer {
  private readonly sessions = new Map<string, ManagedAcpSession>();
  private readonly maxQueued: number;
  private readonly idleMs: number;

  constructor(private readonly createAgent: AcpAgentFactory) {
    this.maxQueued = readEnvInt("QLING_ACP_MAX_QUEUED", DEFAULT_MAX_QUEUED);
    this.idleMs = readEnvInt("QLING_ACP_SESSION_IDLE_MS", DEFAULT_IDLE_MS);
  }

  createApp(): acp.AgentApp {
    return acp.agent({ name: "qling" })
      .onRequest(acp.methods.agent.initialize, (ctx) => this.initialize(ctx.params))
      .onRequest(acp.methods.agent.authenticate, () => ({}))
      .onRequest(acp.methods.agent.session.new, (ctx) => this.newSession(ctx.params))
      .onRequest(acp.methods.agent.session.load, (ctx) => this.loadSession(ctx.params, ctx.client))
      .onRequest(acp.methods.agent.session.setMode, (ctx) => this.setMode(ctx.params))
      .onRequest(acp.methods.agent.session.prompt, (ctx) => this.prompt(ctx.params, ctx.client))
      .onNotification(acp.methods.agent.session.cancel, (ctx) => this.cancel(ctx.params));
  }

  initialize(params: acp.InitializeRequest): acp.InitializeResponse {
    return {
      protocolVersion: params.protocolVersion === acp.PROTOCOL_VERSION
        ? params.protocolVersion
        : acp.PROTOCOL_VERSION,
      agentInfo: { name: "qling", version: getPackageVersion() },
      agentCapabilities: { loadSession: true, promptCapabilities: {} },
    };
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    this.rejectUnsupportedSessionOptions(params);
    const agent = await this.createAgent(await validateCwd(params.cwd));
    await agent.waitForInit();
    const baseId = agent.getSessionId();
    const id = this.sessions.has(baseId)
      ? `${baseId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      : baseId;
    const session = this.trackSession(id, agent);
    return { sessionId: id, modes: modeState(session.modeId) };
  }

  async loadSession(params: acp.LoadSessionRequest, client: acp.AgentContext): Promise<acp.LoadSessionResponse> {
    this.rejectUnsupportedSessionOptions(params);
    const cwd = await validateCwd(params.cwd);
    const id = validateAcpSessionId(params.sessionId);
    if (this.sessions.has(id)) {
      throw acp.RequestError.invalidParams(undefined, "ACP session is already loaded");
    }
    const agent = await this.createAgent(cwd);
    let session: ManagedAcpSession | null = null;
    try {
      await agent.waitForInit();
      if (typeof agent.restoreSession !== "function") {
        throw acp.RequestError.invalidParams(undefined, "ACP session was not found");
      }
      const restored = await agent.restoreSession(id);
      if (!restored) {
        throw acp.RequestError.invalidParams(undefined, "ACP session was not found");
      }
      session = this.trackSession(id, agent);
      const messages = [...(agent.getMessagesSnapshot?.() ?? [])];
      const reminder = await this.interruptedReminder(agent, messages);
      await this.replayHistory(session, client, messages, reminder);
      return { modes: modeState(session.modeId) };
    } catch (error) {
      if (session) {
        this.sessions.delete(session.id);
        this.detachSession(session);
      }
      await agent.shutdown().catch(() => {});
      throw error;
    }
  }

  async setMode(params: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse> {
    const session = this.getSession(params.sessionId);
    if (!MODES.some((mode) => mode.id === params.modeId)) {
      throw acp.RequestError.invalidParams(undefined, `Unknown ACP session mode: ${params.modeId}`);
    }
    session.modeId = params.modeId as AcpModeId;
    applyMode(session.agent, session.modeId);
    this.armIdle(session);
    return {};
  }

  async prompt(params: acp.PromptRequest, client: acp.AgentContext): Promise<acp.PromptResponse> {
    const session = this.getSession(params.sessionId);
    const text = promptText(params.prompt);
    if (session.activePrompt || session.queue.length > 0) {
      return this.enqueue(session, client, text);
    }
    return this.executePrompt(session, client, { cancelled: false }, text);
  }

  cancel(params: acp.CancelNotification): void {
    const session = this.sessions.get(params.sessionId);
    if (!session) return;
    this.cancelSession(session);
  }

  async shutdown(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map(async (session) => {
      this.cancelSession(session);
      this.detachSession(session);
      await session.agent.shutdown();
    }));
  }

  private cancelSession(session: ManagedAcpSession): void {
    session.cancelRequested = true;
    if (session.activeTicket) session.activeTicket.cancelled = true;
    const queued = session.queue.splice(0);
    for (const item of queued) {
      item.cancelled = true;
      item.resolve({ stopReason: "cancelled" });
    }
    session.agent.cancelActiveRun();
  }

  private rejectUnsupportedSessionOptions(params: {
    mcpServers?: readonly unknown[];
    additionalDirectories?: readonly string[];
  }): void {
    if (params.additionalDirectories?.length) {
      throw acp.RequestError.invalidParams(
        undefined,
        "ACP additionalDirectories are not supported in this release",
      );
    }
    if (params.mcpServers?.length) {
      throw acp.RequestError.invalidParams(
        undefined,
        "ACP client-provided MCP servers are not supported in this release",
      );
    }
  }

  private enqueue(session: ManagedAcpSession, client: acp.AgentContext, text: string): Promise<acp.PromptResponse> {
    if (session.queue.length >= this.maxQueued) {
      throw acp.RequestError.invalidParams(
        undefined,
        `ACP prompt queue is full (max ${this.maxQueued})`,
      );
    }
    this.clearIdle(session);
    return new Promise((resolve, reject) => {
      session.queue.push({ text, client, resolve, reject, cancelled: false });
    });
  }

  private async executePrompt(
    session: ManagedAcpSession,
    client: acp.AgentContext,
    ticket: PromptTicket,
    text: string,
  ): Promise<acp.PromptResponse> {
    this.clearIdle(session);
    session.activePrompt = true;
    session.cancelRequested = false;
    session.client = client;
    session.activeTicket = ticket;
    const batcher = new AcpTextBatcher((chunk) => this.sendTextChunk(session, client, "agent_message_chunk", chunk));
    session.batcher = batcher;
    try {
      if (ticket.cancelled) return { stopReason: "cancelled" };
      session.agent.addUserMessage(text);
      const outcome = await this.runAgent(session);
      if (ticket.cancelled || session.cancelRequested || outcome.status === "canceled") {
        await batcher.flush().catch(() => {});
        return { stopReason: "cancelled" };
      }
      await session.pendingNotifications;
      await batcher.flush();
      if (isSoftStop(outcome)) {
        const note = outcome.text.trim() || "执行已暂停，需要恢复后才能继续。";
        if (batcher.sentText !== note) {
          await this.sendTextChunk(session, client, "agent_message_chunk", note);
        }
        return { stopReason: "end_turn" };
      }
      if (outcome.status === "failed") {
        throw acp.RequestError.internalError(undefined, outcome.text || "ACP prompt failed");
      }
      if (!batcher.sentAny && outcome.text) {
        await this.sendTextChunk(session, client, "agent_message_chunk", outcome.text);
      }
      return { stopReason: "end_turn" };
    } catch (error) {
      if (ticket.cancelled || session.cancelRequested || isCanceledError(error)) return { stopReason: "cancelled" };
      throw error;
    } finally {
      if (session.batcher === batcher) session.batcher = null;
      batcher.dispose();
      session.activePrompt = false;
      session.client = null;
      if (session.activeTicket === ticket) session.activeTicket = null;
      this.pumpQueue(session);
      if (!session.activePrompt) this.armIdle(session);
    }
  }

  private async runAgent(session: ManagedAcpSession): Promise<AcpRunOutcome> {
    if (typeof session.agent.runDetailed === "function") {
      const outcome = await session.agent.runDetailed();
      return {
        status: typeof outcome?.status === "string" ? outcome.status : "failed",
        text: typeof outcome?.text === "string" ? outcome.text : "",
        recovery: outcome?.recovery,
      };
    }
    try {
      const text = await session.agent.run();
      return { status: "succeeded", text: typeof text === "string" ? text : String(text ?? "") };
    } catch (error) {
      if (isCanceledError(error)) {
        return { status: "canceled", text: error instanceof Error ? error.message : "canceled" };
      }
      throw error;
    }
  }

  private pumpQueue(session: ManagedAcpSession): void {
    if (!this.sessions.has(session.id) || session.activePrompt) return;
    const next = session.queue.shift();
    if (!next) return;
    if (next.cancelled) {
      next.resolve({ stopReason: "cancelled" });
      this.pumpQueue(session);
      return;
    }
    void this.executePrompt(session, next.client, next, next.text).then(next.resolve, next.reject);
  }

  private async interruptedReminder(agent: AcpAgentSession, messages: readonly AcpReplayMessage[]): Promise<string | null> {
    if (messages.some((message) =>
      message.synthetic_key === INTERRUPTED_RUN_KEY
      || (typeof message.content === "string" && message.content.includes(INTERRUPTED_RUN_REMINDER))
    )) {
      return null;
    }
    const active = agent.getActiveRun?.() ?? null;
    if (!active?.runId) return null;
    if (agent.getRecoveryState?.()?.status === "recovering") return null;
    if (typeof agent.readRunTrace !== "function") return null;
    try {
      const events = await agent.readRunTrace(active.runId);
      return detectInterruptedRun([...events]) ? INTERRUPTED_RUN_REMINDER : null;
    } catch {
      return null;
    }
  }

  private async replayHistory(
    session: ManagedAcpSession,
    client: acp.AgentContext,
    messages: readonly AcpReplayMessage[],
    reminder: string | null,
  ): Promise<void> {
    session.client = client;
    try {
      for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        const text = typeof message.content === "string" ? message.content : "";
        if (message.role === "user" && text) {
          await this.sendTextChunk(session, client, "user_message_chunk", text);
        } else if (message.role === "assistant") {
          if (text) await this.sendTextChunk(session, client, "agent_message_chunk", text);
          for (const call of message.tool_calls ?? []) {
            const name = call.function?.name || "tool";
            const id = call.id || `replay-${index}-${name}`;
            let raw: unknown = call.function?.arguments ?? {};
            if (typeof raw === "string" && raw) {
              try {
                raw = JSON.parse(raw) as unknown;
              } catch {
                // Keep the raw argument string when it is not JSON.
              }
            }
            await this.notify(client, session.id, {
              sessionUpdate: "tool_call",
              toolCallId: id,
              title: name,
              kind: toolKind(name),
              status: "completed",
              rawInput: truncateRawInput(raw),
            });
          }
        } else if (message.role === "tool") {
          await this.notify(client, session.id, {
            sessionUpdate: "tool_call_update",
            toolCallId: message.tool_call_id || `replay-tool-${index}`,
            status: "completed",
            content: [{
              type: "content",
              content: { type: "text", text: summarizeAcpToolOutput(text) },
            }],
          });
        }
      }
      if (reminder) await this.sendTextChunk(session, client, "user_message_chunk", reminder);
    } finally {
      session.client = null;
    }
  }

  private trackSession(id: string, agent: AcpAgentSession): ManagedAcpSession {
    const session: ManagedAcpSession = {
      id,
      agent,
      modeId: "normal",
      activePrompt: false,
      cancelRequested: false,
      client: null,
      activeTicket: null,
      queue: [],
      tools: new Map(),
      unsubscribers: [],
      pendingNotifications: Promise.resolve(),
      idleTimer: null,
      batcher: null,
    };
    applyMode(agent, session.modeId);
    agent.setChannel(new AcpApprovalChannel(session));
    session.unsubscribers.push(agent.subscribeExecutionEvents((event) => {
      if (event.type === "tool_started" && event.toolCallId) this.ensureToolSlot(session, event);
      session.pendingNotifications = session.pendingNotifications
        .then(() => this.forwardExecutionEvent(session, event))
        .catch(() => {});
    }));
    session.unsubscribers.push(subscribeAgent(agent, "response_delta", (delta) => {
      const text = typeof delta === "string" ? delta : String(delta ?? "");
      session.batcher?.push(text);
    }));
    session.unsubscribers.push(subscribeAgent(agent, "model_retry", (info) => {
      const payload = info && typeof info === "object"
        ? info as { attempt?: unknown; max?: unknown; kind?: unknown; model?: unknown }
        : {};
      const attempt = typeof payload.attempt === "number" ? payload.attempt : "?";
      const max = typeof payload.max === "number" ? payload.max : "?";
      const kind = String(payload.kind ?? "retry").slice(0, 64);
      const model = String(payload.model ?? "").slice(0, 128);
      session.batcher?.push(`\n[模型重试 ${attempt}/${max}：${kind}${model ? ` ${model}` : ""}]\n`);
    }));
    session.unsubscribers.push(subscribeAgent(agent, "tool_start", (name, args) => {
      this.noteToolStart(session, String(name ?? ""), args);
    }));
    session.unsubscribers.push(subscribeAgent(agent, "tool_result", (name, output, isError) => {
      this.noteToolResult(session, String(name ?? ""), output, Boolean(isError));
    }));
    session.unsubscribers.push(subscribeAgent(agent, "plan", (payload) => {
      this.queuePlan(session, payload);
    }));
    session.unsubscribers.push(subscribeAgent(agent, "todo", (payload) => {
      this.queuePlan(session, payload);
    }));
    this.sessions.set(id, session);
    this.armIdle(session);
    return session;
  }

  private noteToolStart(session: ManagedAcpSession, name: string, args: unknown): void {
    const slot = [...session.tools.values()].reverse().find((item) => item.tool === name && !item.rawInputSeen);
    if (!slot) return;
    slot.rawInput = args;
    slot.rawInputSeen = true;
    if (name === "todo" || name === "planner") this.queuePlan(session, args);
  }

  private noteToolResult(session: ManagedAcpSession, name: string, output: unknown, isError: boolean): void {
    const slot = [...session.tools.values()].reverse().find((item) => item.tool === name && !item.outputSeen);
    if (!slot) return;
    slot.output = typeof output === "string" ? output : JSON.stringify(output ?? "");
    slot.outputSeen = true;
    if (isError) slot.failed = true;
    if (name === "todo" || name === "planner") {
      let parsed: unknown = slot.output;
      try {
        parsed = JSON.parse(slot.output) as unknown;
      } catch {
        parsed = slot.output;
      }
      this.queuePlan(session, parsed);
    }
  }

  private queuePlan(session: ManagedAcpSession, value: unknown): void {
    const entries = planEntriesFromUnknown(value);
    if (!entries) return;
    session.pendingNotifications = session.pendingNotifications.then(async () => {
      const client = session.client;
      if (!client) return;
      await this.notify(client, session.id, { sessionUpdate: "plan", entries });
    }).catch(() => {});
  }

  private async forwardExecutionEvent(session: ManagedAcpSession, event: ExecutionEvent): Promise<void> {
    const client = session.client;
    if (!client) return;
    if (!event.toolCallId) return;
    if (event.type === "tool_started") {
      const slot = this.ensureToolSlot(session, event);
      await this.notify(client, session.id, {
        sessionUpdate: "tool_call",
        toolCallId: event.toolCallId,
        title: event.tool ?? "tool",
        kind: toolKind(event.tool),
        status: "in_progress",
        ...(slot.rawInputSeen ? { rawInput: truncateRawInput(slot.rawInput) } : {}),
      });
      return;
    }
    if (event.type === "tool_completed") {
      const slot = session.tools.get(event.toolCallId);
      const failed = event.status === "failed" || slot?.failed === true;
      await this.notify(client, session.id, {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        status: failed ? "failed" : "completed",
        ...(slot?.outputSeen
          ? {
            content: [{
              type: "content" as const,
              content: { type: "text" as const, text: summarizeAcpToolOutput(slot.output ?? "") },
            }],
          }
          : {}),
      });
    }
  }

  private ensureToolSlot(session: ManagedAcpSession, event: ExecutionEvent): ToolSlot {
    const existing = event.toolCallId ? session.tools.get(event.toolCallId) : undefined;
    if (existing) return existing;
    const slot: ToolSlot = {
      toolCallId: event.toolCallId || "tool",
      tool: event.tool,
      rawInputSeen: false,
      outputSeen: false,
      failed: false,
    };
    if (event.toolCallId) session.tools.set(event.toolCallId, slot);
    return slot;
  }

  private async sendTextChunk(
    session: ManagedAcpSession,
    client: acp.AgentContext,
    sessionUpdate: "agent_message_chunk" | "user_message_chunk",
    text: string,
  ): Promise<void> {
    if (!text) return;
    await this.notify(client, session.id, {
      sessionUpdate,
      content: { type: "text", text },
    });
  }

  private async notify(client: acp.AgentContext, sessionId: string, update: acp.SessionUpdate): Promise<void> {
    await client.notify(acp.methods.client.session.update, { sessionId, update });
  }

  private armIdle(session: ManagedAcpSession): void {
    this.clearIdle(session);
    if (!this.sessions.has(session.id) || session.activePrompt || session.queue.length > 0) return;
    const timer = setTimeout(() => {
      void this.retireIfIdle(session);
    }, this.idleMs);
    if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
    session.idleTimer = timer;
  }

  private clearIdle(session: ManagedAcpSession): void {
    if (!session.idleTimer) return;
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }

  private async retireIfIdle(session: ManagedAcpSession): Promise<void> {
    if (!this.sessions.has(session.id)) return;
    if (session.activePrompt || session.queue.length > 0) {
      this.armIdle(session);
      return;
    }
    this.sessions.delete(session.id);
    this.detachSession(session);
    session.agent.cancelActiveRun();
    await session.agent.shutdown().catch(() => {});
  }

  private detachSession(session: ManagedAcpSession): void {
    this.clearIdle(session);
    session.batcher?.dispose();
    session.batcher = null;
    for (const unsubscribe of session.unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {
        // Listener cleanup must not block shutdown.
      }
    }
  }

  private getSession(sessionId: string): ManagedAcpSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw acp.RequestError.invalidParams(undefined, `Unknown ACP session: ${sessionId}`);
    return session;
  }
}

export async function runAcpStdioServer(
  createAgent: AcpAgentFactory,
  io: { input?: Readable; output?: Writable } = {},
): Promise<void> {
  const restoreConsole = installAcpStdoutGuard();
  const server = new QlingAcpServer(createAgent);
  const output = Writable.toWeb(io.output ?? process.stdout) as WritableStream<Uint8Array>;
  const input = Readable.toWeb(io.input ?? process.stdin) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(output, input);
  const connection = server.createApp().connect(stream);
  try {
    await connection.closed;
  } finally {
    await server.shutdown();
    restoreConsole();
  }
}
