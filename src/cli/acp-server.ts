import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

import type { Channel } from "../channels/types.js";
import type { ApprovalRequest, ApprovalResponse } from "../types.js";
import type { ExecutionEvent } from "../execution/types.js";
import { getPackageVersion } from "../package-version.js";

export interface AcpAgentSession {
  waitForInit(): Promise<void>;
  getSessionId(): string;
  addUserMessage(content: string): void;
  run(): Promise<string>;
  setChannel(channel: Channel): void;
  setPlanMode(enabled: boolean): void;
  setPermissionMode(mode: "allow" | "deny" | "ask"): void;
  subscribeExecutionEvents(listener: (event: ExecutionEvent) => void): () => void;
  cancelActiveRun(): boolean;
  shutdown(): Promise<void>;
}

export type AcpAgentFactory = (cwd: string) => AcpAgentSession | Promise<AcpAgentSession>;
type AcpModeId = "normal" | "plan" | "auto";

interface ManagedAcpSession {
  id: string;
  agent: AcpAgentSession;
  modeId: AcpModeId;
  activePrompt: boolean;
  cancelRequested: boolean;
  client: acp.AgentContext | null;
  unsubscribe: () => void;
  pendingNotifications: Promise<void>;
}

const MODES: acp.SessionMode[] = [
  { id: "normal", name: "Normal", description: "Execute with approval prompts for sensitive tools." },
  { id: "plan", name: "Plan", description: "Plan without making workspace changes." },
  { id: "auto", name: "Auto", description: "Execute tools without interactive approval prompts." },
];

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

function denied(requestId: string): ApprovalResponse {
  return { requestId, decision: "deny", timestamp: Date.now() };
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
    if (!client || this.session.cancelRequested) return denied(request.id);
    const response = await client.request(acp.methods.client.session.requestPermission, {
      sessionId: this.session.id,
      toolCall: {
        toolCallId: request.id,
        title: `${request.toolName}: ${request.reason}`,
        kind: toolKind(request.toolName),
        status: "pending",
        rawInput: request.arguments,
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

function isCanceledError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "AgentRunCanceledError" || /aborted|cancell?ed/i.test(error.message));
}

export class QlingAcpServer {
  private readonly sessions = new Map<string, ManagedAcpSession>();
  constructor(private readonly createAgent: AcpAgentFactory) {}

  createApp(): acp.AgentApp {
    return acp.agent({ name: "qling" })
      .onRequest(acp.methods.agent.initialize, (ctx) => this.initialize(ctx.params))
      .onRequest(acp.methods.agent.authenticate, () => ({}))
      .onRequest(acp.methods.agent.session.new, (ctx) => this.newSession(ctx.params))
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
      agentCapabilities: { loadSession: false, promptCapabilities: {} },
    };
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    if (params.additionalDirectories?.length) {
      throw acp.RequestError.invalidParams(
        undefined,
        "ACP additionalDirectories are not supported in this release",
      );
    }
    if (params.mcpServers.length) {
      throw acp.RequestError.invalidParams(
        undefined,
        "ACP client-provided MCP servers are not supported in this release",
      );
    }
    const agent = await this.createAgent(await validateCwd(params.cwd));
    await agent.waitForInit();
    const baseId = agent.getSessionId();
    const id = this.sessions.has(baseId)
      ? `${baseId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      : baseId;
    const session: ManagedAcpSession = {
      id,
      agent,
      modeId: "normal",
      activePrompt: false,
      cancelRequested: false,
      client: null,
      unsubscribe: () => {},
      pendingNotifications: Promise.resolve(),
    };
    applyMode(agent, session.modeId);
    agent.setChannel(new AcpApprovalChannel(session));
    session.unsubscribe = agent.subscribeExecutionEvents((event) => {
      session.pendingNotifications = session.pendingNotifications
        .then(() => this.forwardExecutionEvent(session, event))
        .catch(() => {});
    });
    this.sessions.set(id, session);
    return { sessionId: id, modes: modeState(session.modeId) };
  }

  async setMode(params: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse> {
    const session = this.getSession(params.sessionId);
    if (!MODES.some((mode) => mode.id === params.modeId)) {
      throw acp.RequestError.invalidParams(undefined, `Unknown ACP session mode: ${params.modeId}`);
    }
    session.modeId = params.modeId as AcpModeId;
    applyMode(session.agent, session.modeId);
    return {};
  }

  async prompt(params: acp.PromptRequest, client: acp.AgentContext): Promise<acp.PromptResponse> {
    const session = this.getSession(params.sessionId);
    if (session.activePrompt) throw new Error(`ACP session ${session.id} already has an active prompt`);
    session.activePrompt = true;
    session.cancelRequested = false;
    session.client = client;
    try {
      session.agent.addUserMessage(promptText(params.prompt));
      const response = await session.agent.run();
      if (session.cancelRequested) return { stopReason: "cancelled" };
      await session.pendingNotifications;
      await client.notify(acp.methods.client.session.update, {
        sessionId: session.id,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: response },
        },
      });
      return { stopReason: "end_turn" };
    } catch (error) {
      if (session.cancelRequested || isCanceledError(error)) return { stopReason: "cancelled" };
      throw error;
    } finally {
      session.activePrompt = false;
      session.client = null;
    }
  }

  cancel(params: acp.CancelNotification): void {
    const session = this.sessions.get(params.sessionId);
    if (!session) return;
    session.cancelRequested = true;
    session.agent.cancelActiveRun();
  }

  async shutdown(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map(async (session) => {
      session.unsubscribe();
      session.agent.cancelActiveRun();
      await session.agent.shutdown();
    }));
  }

  private getSession(sessionId: string): ManagedAcpSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw acp.RequestError.invalidParams(undefined, `Unknown ACP session: ${sessionId}`);
    return session;
  }

  private async forwardExecutionEvent(session: ManagedAcpSession, event: ExecutionEvent): Promise<void> {
    const client = session.client;
    if (!client || !event.toolCallId) return;
    if (event.type === "tool_started") {
      await client.notify(acp.methods.client.session.update, {
        sessionId: session.id,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: event.toolCallId,
          title: event.tool ?? "tool",
          kind: toolKind(event.tool),
          status: "in_progress",
        },
      });
    } else if (event.type === "tool_completed") {
      await client.notify(acp.methods.client.session.update, {
        sessionId: session.id,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolCallId,
          status: event.status === "failed" ? "failed" : "completed",
        },
      });
    }
  }
}

export async function runAcpStdioServer(createAgent: AcpAgentFactory): Promise<void> {
  const server = new QlingAcpServer(createAgent);
  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const input = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(output, input);
  const connection = server.createApp().connect(stream);
  try {
    await connection.closed;
  } finally {
    await server.shutdown();
  }
}
