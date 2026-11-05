// ============================================================
// 轻灵 - MCP 客户端（transport 抽象）
// 支持 stdio 和 HTTP (Streamable) transport
// ============================================================

import type { MCPServerConfig, MCPToolDefinition, MCPConnectResult, MCPMessage, MCPToolCallResult } from "./types.js";
import type { ToolResult } from "../types.js";
import { StdioTransport } from "./stdio-transport.js";
import { HttpTransport } from "./http-transport.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

interface MCPTransport {
  send(msg: MCPMessage, signal?: AbortSignal): void | Promise<void>;
  onMessage(handler: (msg: MCPMessage) => void): void;
  onError(handler: (err: Error) => void): void;
  onClose(handler: () => void): void;
  close(): Promise<void>;
}

/** 单件 MCP 附件上限：超过时不落盘，避免把大 payload 复制进工作树。 */
const MAX_MCP_ARTIFACT_BYTES = 8 * 1024 * 1024;

export interface MCPArtifact {
  type: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  artifactRef?: string;
  path?: string;
  skipped?: string;
}

/** 带结构化分类的 MCP 请求错误，避免取消/超时/未知结果被压扁成普通文本。 */
export class MCPRequestError extends Error {
  constructor(
    message: string,
    readonly code: "MCP_CANCELED" | "MCP_TIMEOUT" | "MCP_REQUEST_FAILED",
    readonly requestId?: string | number,
  ) {
    super(message);
    this.name = "MCPRequestError";
  }
}

export class MCPClient {
  private config: MCPServerConfig;
  private transport: MCPTransport | null = null;
  private msgId = 0;
  private pending = new Map<string | number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private connected = false;
  private tools: MCPToolDefinition[] = [];
  private connectionTimeout: number;
  private callTimeout: number;

  constructor(config: MCPServerConfig, private timeouts?: { connection?: number; call?: number; inheritEnv?: boolean; maxMessageBytes?: number; logStderr?: boolean }) {
    this.config = config;
    this.connectionTimeout = timeouts?.connection ?? 10_000;
    this.callTimeout = timeouts?.call ?? 30_000;
  }

  async connect(): Promise<MCPConnectResult> {
    try {
      const transportType = this.config.transport ?? "stdio";

      if (transportType === "http") {
        if (!this.config.url) {
          return { serverName: this.config.name, tools: [], status: "failed", error: "HTTP transport requires url" };
        }
        this.transport = new HttpTransport(
          this.config.url,
          this.config.headers,
          this.callTimeout,
        );
      } else {
        const stdio = new StdioTransport(
          this.config.command,
          this.config.args,
          this.config.env,
          this.timeouts,
        );
        // Wait for spawn
        await Promise.race([
          stdio.ready(),
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error("spawn timeout")), this.connectionTimeout)),
        ]);

        if (!stdio.isAlive()) {
          return { serverName: this.config.name, tools: [], status: "failed", error: "Failed to spawn process" };
        }
        this.transport = stdio;
      }

      // Wire up message/error/close handlers
      this.transport.onMessage((msg) => this.handleMessage(msg));
      this.transport.onError((err) => {
        this.connected = false;
        for (const [id, { reject }] of this.pending) {
          reject(err);
          this.pending.delete(id);
        }
      });
      this.transport.onClose(() => {
        this.connected = false;
        for (const [id, { reject }] of this.pending) {
          reject(new Error("MCP transport closed"));
          this.pending.delete(id);
        }
      });

      // 1. initialize
      const initResult = await this.sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "qling", version: "0.2" },
      });

      if (!initResult) {
        return { serverName: this.config.name, tools: [], status: "failed", error: "initialize failed: no response" };
      }

      // 2. initialized notification
      await this.sendNotification("notifications/initialized");

      // 3. tools/list
      const toolsResult = await this.sendRequest("tools/list", {});
      if (toolsResult && typeof toolsResult === "object" && "tools" in toolsResult) {
        const rawTools = (toolsResult as { tools: unknown[] }).tools;
        this.tools = rawTools.map((t: any) => ({
          serverName: this.config.name,
          name: t.name,
          description: t.description ?? "",
          inputSchema: t.inputSchema ?? {},
          annotations:
            t.annotations && typeof t.annotations === "object"
              ? {
                  readOnlyHint: t.annotations.readOnlyHint === true,
                  destructiveHint: t.annotations.destructiveHint === true,
                }
              : undefined,
        }));
      }

      this.connected = true;
      return { serverName: this.config.name, tools: this.tools, status: "connected" };
    } catch (err) {
      return {
        serverName: this.config.name,
        tools: [],
        status: "failed",
        error: (err as Error).message,
      };
    }
  }

  async callToolRaw(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<MCPToolCallResult> {
    if (!this.connected || !this.transport) throw new Error("MCP server not connected");
    const result = await this.sendRequest("tools/call", { name, arguments: args }, undefined, signal);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid MCP tool result");
    return result as MCPToolCallResult;
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (!this.connected || !this.transport) {
      return {
        tool_call_id: "mcp_" + name,
        output: "[MCP Error] Server " + this.config.name + " not connected",
        is_error: true,
      };
    }

    try {
      const result = await this.sendRequest("tools/call", { name, arguments: args }, undefined, signal);
      if (!result) {
        return {
          tool_call_id: "mcp_" + name,
          output: "[MCP Error] No response from " + this.config.name,
          is_error: true,
        };
      }

      const r = result as any;
      if (r.isError) {
        const errorText = r.error?.message ?? r.content?.[0]?.text ?? JSON.stringify(r);
        return {
          tool_call_id: "mcp_" + name,
          output: "[MCP Error] " + errorText,
          is_error: true,
        };
      }

      const parts = Array.isArray(r.content) ? (r.content as Array<Record<string, unknown>>) : [];
      const texts = parts
        .filter((c) => c.type === "text")
        .map((c) => String(c.text ?? ""))
        .filter((text) => text.length > 0);
      const artifacts = await this.persistArtifacts(parts);
      const artifactNotes = artifacts.map((artifact) =>
        artifact.artifactRef
          ? `[MCP ${artifact.type} artifact: ${artifact.mimeType}, ${artifact.bytes} bytes, ref=${artifact.artifactRef}]`
          : `[MCP ${artifact.type} artifact unavailable: ${artifact.skipped ?? "not stored"}]`
      );

      let output = texts.join("\n");
      if (!output && r.structuredContent !== undefined) {
        try {
          output = JSON.stringify(r.structuredContent);
        } catch {
          output = "";
        }
      }
      if (!output) output = artifactNotes.join("\n") || "[MCP] Tool returned no text content";
      else if (artifactNotes.length > 0) output += "\n" + artifactNotes.join("\n");

      const stored = artifacts.find((artifact) => artifact.artifactRef);
      return {
        tool_call_id: "mcp_" + name,
        output,
        is_error: false,
        meta: {
          mcp: summarizeMcpResult(this.config.name, name, r),
          ...(stored
            ? {
                artifactRef: stored.artifactRef,
                artifactPath: stored.path,
                artifacts: artifacts.map(({ path: _path, ...artifact }) => artifact),
              }
            : {}),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const canceled =
        signal?.aborted === true ||
        (err instanceof MCPRequestError && err.code === "MCP_CANCELED") ||
        /aborted|cancell?ed/i.test(message);
      const timedOut = !canceled && (/timeout/i.test(message) || (err instanceof MCPRequestError && err.code === "MCP_TIMEOUT"));
      const code: MCPRequestError["code"] = canceled ? "MCP_CANCELED" : timedOut ? "MCP_TIMEOUT" : "MCP_REQUEST_FAILED";
      return {
        tool_call_id: "mcp_" + name,
        output: `[MCP Error] [${code}] ${message}`,
        is_error: true,
        error: {
          code,
          message,
          retriable: timedOut,
          category: "runtime",
        },
        meta: {
          mcp: {
            server: this.config.name,
            tool: name,
            ...(canceled
              ? {
                  cancellation: {
                    requested: true,
                    localWaitCanceled: true,
                    remoteStopConfirmed: false,
                    sideEffectCertainty: "unknown",
                  },
                }
              : {}),
          },
        },
      };
    }
  }

  /** 把 image/audio/resource blob 落盘为内容寻址附件，返回可消费引用（不复制 base64 进 meta）。 */
  private async persistArtifacts(parts: Array<Record<string, unknown>>): Promise<MCPArtifact[]> {
    const artifacts: MCPArtifact[] = [];
    const root = process.env.QLING_MCP_ARTIFACT_DIR?.trim() || path.join(os.tmpdir(), "qling-mcp-artifacts");
    const dir = path.resolve(root, sanitizeSegment(this.config.name));

    for (const part of parts) {
      const type = String(part.type ?? "");
      let bytes: Buffer | null = null;
      let mimeType = "application/octet-stream";

      if (type === "image" || type === "audio") {
        mimeType = String(part.mimeType ?? part.mime_type ?? `${type}/unknown`);
        bytes = Buffer.from(String(part.data ?? ""), "base64");
      } else if (type === "resource") {
        const resource = part.resource && typeof part.resource === "object"
          ? part.resource as Record<string, unknown>
          : undefined;
        if (resource && typeof resource.blob === "string") {
          mimeType = String(resource.mimeType ?? "application/octet-stream");
          bytes = Buffer.from(resource.blob, "base64");
        }
      }
      if (!bytes || bytes.byteLength === 0) continue;

      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (bytes.byteLength > MAX_MCP_ARTIFACT_BYTES) {
        artifacts.push({ type, mimeType, bytes: bytes.byteLength, sha256, skipped: "exceeds_artifact_limit" });
        continue;
      }

      try {
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        const target = path.resolve(path.join(dir, `${sha256}${extensionForMime(mimeType)}`));
        if (!target.startsWith(dir + path.sep)) throw new Error("artifact path escapes directory");
        try {
          await fs.writeFile(target, bytes, { mode: 0o600, flag: "wx" });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        artifacts.push({
          type,
          mimeType,
          bytes: bytes.byteLength,
          sha256,
          artifactRef: `artifact://sha256/${sha256}`,
          path: target,
        });
      } catch (error) {
        artifacts.push({
          type,
          mimeType,
          bytes: bytes.byteLength,
          sha256,
          skipped: (error as Error).message.slice(0, 200),
        });
      }
    }
    return artifacts;
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      try {
        await this.sendNotification("shutdown");
        await new Promise((r) => setTimeout(r, 500));
      } catch {
        // ignore
      }
      await this.transport.close();
      this.transport = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getServerName(): string {
    return this.config.name;
  }

  getTools(): MCPToolDefinition[] {
    return [...this.tools];
  }

  // --- Private ---

  private handleMessage(msg: MCPMessage): void {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        reject(new Error("MCP error: " + msg.error.message));
      } else {
        resolve(msg.result);
      }
    }
  }

  private sendRequest(method: string, params: unknown, timeout?: number, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new MCPRequestError("MCP request aborted", "MCP_CANCELED")); return; }
      const id = ++this.msgId;
      const msg: MCPMessage = { jsonrpc: "2.0", id, method, params };
      const ms = timeout ?? (method === "initialize" ? this.connectionTimeout : this.callTimeout);
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          signal?.removeEventListener("abort", aborted);
          reject(new MCPRequestError("MCP request timeout: " + method, "MCP_TIMEOUT", id));
        }
      }, ms);
      const settle = <T extends unknown[]>(fn: (...args: T) => void) => (...args: T) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", aborted);
        fn(...args);
      };
      const aborted = () => {
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          pending.reject(new MCPRequestError("MCP request aborted", "MCP_CANCELED", id));
          // 尽力通知远端停止；server 可以忽略，因此结果仍标记 remoteStopConfirmed=false。
          void this.sendNotification("notifications/cancelled", {
            requestId: id,
            reason: "client aborted",
          }).catch(() => undefined);
        }
      };
      this.pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      signal?.addEventListener("abort", aborted, { once: true });

      try {
        const result = this.transport!.send(msg, signal);
        // If transport.send returns a promise (HTTP), handle errors
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch((err) => {
            const pending = this.pending.get(id);
            if (pending) {
              this.pending.delete(id);
              pending.reject(err);
            }
          });
        }
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        signal?.removeEventListener("abort", aborted);
        reject(err);
        return;
      }
    });
  }

  private async sendNotification(method: string, params?: unknown): Promise<void> {
    if (!this.transport) return;
    const msg: MCPMessage = { jsonrpc: "2.0", method, params };
    await this.transport.send(msg);
  }
}

/** 保留 MCP 原始结果的结构摘要，不把图片 base64 复制进 ToolResult.meta。 */
export function summarizeMcpResult(
  serverName: string,
  toolName: string,
  result: unknown
): Record<string, unknown> {
  const r = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const rawContent = Array.isArray(r.content) ? r.content : [];
  const content = rawContent.map((entry) => {
    const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const type = String(item.type ?? "unknown");
    if (type === "text") {
      const text = String(item.text ?? "");
      return { type, chars: text.length, preview: text.slice(0, 400) };
    }
    if (type === "image" || type === "audio") {
      const byteSource = type === "image" ? item.data : (item.data ?? item.blob);
      return {
        type,
        mimeType: item.mimeType ?? item.mime_type ?? `${type}/unknown`,
        bytes: Buffer.byteLength(String(byteSource ?? ""), "base64"),
      };
    }
    if (type === "resource") {
      const resource = item.resource && typeof item.resource === "object"
        ? item.resource as Record<string, unknown>
        : undefined;
      if (resource) {
        return {
          type,
          uri: typeof resource.uri === "string" ? resource.uri : undefined,
          mimeType: resource.mimeType ?? "application/octet-stream",
          bytes: typeof resource.blob === "string" ? Buffer.byteLength(resource.blob, "base64") : 0,
        };
      }
    }
    return { type };
  });

  let structuredContent: unknown = r.structuredContent;
  if (structuredContent !== undefined) {
    try {
      const encoded = JSON.stringify(structuredContent);
      if (Buffer.byteLength(encoded, "utf8") > 16 * 1024) {
        structuredContent = { truncated: true, bytes: Buffer.byteLength(encoded, "utf8") };
      }
    } catch {
      structuredContent = { truncated: true, reason: "unserializable" };
    }
  }

  return {
    server: serverName,
    tool: toolName,
    content,
    ...(structuredContent !== undefined ? { structuredContent } : {}),
  };
}

function sanitizeSegment(value: string): string {
  const cleaned = String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  return cleaned || "server";
}

function extensionForMime(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.trim().replace(/[^A-Za-z0-9]/g, "");
  return subtype ? `.${subtype.slice(0, 16)}` : ".bin";
}
