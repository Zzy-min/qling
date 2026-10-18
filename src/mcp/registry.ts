// ============================================================
// 轻灵 - MCP 服务器注册表（生命周期管理）
// ============================================================

import { MCPClient } from "./client.js";
import type { MCPServerConfig, MCPToolDefinition, MCPConnectResult } from "./types.js";
import type { ToolResult } from "../types.js";
import { ToolCatalog, type ToolCatalogMatch } from "./tool-catalog.js";
import { getRuntimeExecutionIdentity, getRuntimeRootsFromEnv } from "../runtime-paths.js";
import { mkdir, writeFile } from "fs/promises";
import { join, resolve, sep } from "path";

const DEFAULT_MAX_OUTPUT_BYTES = 20 * 1024;
const MIN_MAX_OUTPUT_BYTES = 1024;
const LONG_LINE_BYTES = 2000;

export class MCPRegistry {
  private clients = new Map<string, MCPClient>();
  private connectionTimeout: number;
  private callTimeout: number;
  private maxOutputBytes: number;
  private perServerMaxBytes = new Map<string, number>();
  private spillCounter = 0;
  private catalog = new ToolCatalog();

  constructor(timeouts?: { connection?: number; call?: number; maxOutputBytes?: number }) {
    this.connectionTimeout = timeouts?.connection ?? 10_000;
    this.callTimeout = timeouts?.call ?? 30_000;
    this.maxOutputBytes = Math.max(MIN_MAX_OUTPUT_BYTES, timeouts?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
  }

  registerServer(config: MCPServerConfig): void {
    const client = new MCPClient(config, {
      connection: config.connection_timeout_ms ?? this.connectionTimeout,
      call: config.call_timeout_ms ?? this.callTimeout,
    });
    this.clients.set(config.name, client);
    // per-server 上限优先于全局 / 环境变量上限。
    const configured = Number(config.max_output_bytes);
    this.perServerMaxBytes.set(
      config.name,
      Number.isFinite(configured) && configured > 0
        ? Math.max(MIN_MAX_OUTPUT_BYTES, configured)
        : this.maxOutputBytes
    );
  }

  async connectAll(): Promise<MCPConnectResult[]> {
    const results: MCPConnectResult[] = [];
    for (const [name, client] of this.clients) {
      if (!client.isConnected()) {
        const result = await client.connect();
        results.push(result);
      }
    }
    return results;
  }

  async connectServer(name: string): Promise<MCPConnectResult> {
    const client = this.clients.get(name);
    if (!client) {
      return { serverName: name, tools: [], status: "failed", error: "Server not registered" };
    }
    return client.connect();
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect();
    }
  }

  async disconnectServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) await client.disconnect();
  }

  getAllTools(): MCPToolDefinition[] {
    const all: MCPToolDefinition[] = [];
    for (const client of this.clients.values()) {
      if (client.isConnected()) {
        all.push(...client.getTools());
      }
    }
    this.catalog.replace(all);
    return all;
  }

  searchTools(query: string, limit = 5): ToolCatalogMatch[] {
    this.catalog.replace(this.collectTools());
    return this.catalog.search(query, limit);
  }

  getCatalogTool(fullName: string): MCPToolDefinition | undefined {
    this.catalog.replace(this.collectTools());
    return this.catalog.get(fullName);
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const client = this.clients.get(serverName);
    if (!client || !client.isConnected()) {
      return {
        tool_call_id: "mcp_" + serverName + "__" + toolName,
        output: "[MCP Error] Server " + serverName + " not connected",
        is_error: true,
      };
    }
    const result = await client.callTool(toolName, args);
    const maxBytes = this.perServerMaxBytes.get(serverName) ?? this.maxOutputBytes;
    const identity = getRuntimeExecutionIdentity();
    const roots = getRuntimeRootsFromEnv();
    const dumpDir = join(roots.fileStateDir, "sessions", identity.sessionId ?? "default", "mcp");
    const callId = `${serverName}__${toolName}__${++this.spillCounter}`;
    return await spillMcpResult(result, { maxBytes, dumpDir, callId });
  }

  getConnectedServers(): string[] {
    const names: string[] = [];
    for (const [name, client] of this.clients) {
      if (client.isConnected()) names.push(name);
    }
    return names;
  }

  getStatus(): Record<string, "connected" | "disconnected"> {
    const status: Record<string, "connected" | "disconnected"> = {};
    for (const [name, client] of this.clients) {
      status[name] = client.isConnected() ? "connected" : "disconnected";
    }
    return status;
  }

  getClient(serverName: string): MCPClient | undefined {
    return this.clients.get(serverName);
  }

  private collectTools(): MCPToolDefinition[] {
    const all: MCPToolDefinition[] = [];
    for (const client of this.clients.values()) {
      if (client.isConnected()) all.push(...client.getTools());
    }
    return all;
  }
}

// ============================================================
// MCP 输出落盘（超限时把全文写入会话目录并回填路径指针）
// ============================================================

export type McpDumpKind = "json-long-line" | "json" | "text-long-line" | "text";

export interface McpSpillOptions {
  maxBytes?: number;
  /** 落盘目录（运行时为 <runtimeRootDir>/sessions/<sessionId>/mcp） */
  dumpDir?: string;
  /** 落盘文件名 stem，非法字符会被替换为 `_` */
  callId?: string;
}

interface McpDumpClassification {
  kind: McpDumpKind;
  extension: "json" | "txt";
  hint: string;
}

/** call_id → 安全文件名片段：仅保留 [A-Za-z0-9_-]，其余替换为 `_`。 */
export function sanitizeMcpDumpStem(callId: string): string {
  const cleaned = String(callId ?? "").replace(/[^A-Za-z0-9_-]/g, "_");
  return cleaned || "mcp-output";
}

function classifyMcpOutput(output: string): McpDumpClassification {
  let isJson = false;
  try {
    JSON.parse(output);
    isJson = true;
  } catch {
    isJson = false;
  }
  const hasLongLine = output
    .split("\n")
    .some((line) => Buffer.byteLength(line, "utf8") > LONG_LINE_BYTES);

  if (isJson) {
    return hasLongLine
      ? {
          kind: "json-long-line",
          extension: "json",
          hint: "单行 JSON，read/grep 无效，请用 bash + node -e/jq 查询",
        }
      : { kind: "json", extension: "json", hint: "JSON 内容，请用 bash + jq 查询" };
  }
  return hasLongLine
    ? {
        kind: "text-long-line",
        extension: "txt",
        hint: "长行文本，read/grep 单行无效，请用 bash 切片查看",
      }
    : { kind: "text", extension: "txt", hint: "请用 read/grep 分段查看" };
}

/** UTF-8 安全前缀：按字节预算切片后去掉尾部不完整序列产生的替换字符。 */
function decodeUtf8Prefix(text: string, budgetBytes: number): string {
  if (budgetBytes <= 0) return "";
  const buf = Buffer.from(text, "utf8");
  const sliced = buf.subarray(0, Math.min(buf.length, budgetBytes));
  let decoded = new TextDecoder("utf-8", { fatal: false }).decode(sliced);
  while (decoded.endsWith("\uFFFD")) decoded = decoded.slice(0, -1);
  return decoded;
}

function buildSpillSuffix(
  shownBytes: number,
  originalBytes: number,
  filePath: string,
  hint: string
): string {
  return `\n[MCP 输出已截断：显示前 ${shownBytes} / 共 ${originalBytes}。完整内容：${filePath}。${hint}]`;
}

/** 写盘不可用时的旧行为：仅按字节预算截断并加简短后缀。 */
function truncateMcpResultInline(result: ToolResult, maxBytes: number): ToolResult {
  const originalBytes = Buffer.byteLength(result.output, "utf8");
  const suffix = "\n…[MCP output truncated by byte budget]";
  const bodyBudget = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
  const body = decodeUtf8Prefix(result.output, bodyBudget);
  return {
    ...result,
    output: body + suffix,
    meta: {
      ...(result.meta ?? {}),
      truncated: true,
      originalBytes,
      returnedBytes: Buffer.byteLength(body + suffix, "utf8"),
      maxBytes,
    },
  };
}

/**
 * 超限时把全文写入 `<dumpDir>/<sanitize(callId)>.<json|txt>`，内联保留 UTF-8 安全前缀
 * 并追加路径指针 + 查询提示；写盘失败时回退到纯内联截断且不抛错。
 */
export async function spillMcpResult(
  result: ToolResult,
  options: McpSpillOptions = {}
): Promise<ToolResult> {
  const maxBytes = Math.max(
    MIN_MAX_OUTPUT_BYTES,
    Number.isFinite(options.maxBytes) ? Number(options.maxBytes) : DEFAULT_MAX_OUTPUT_BYTES
  );
  const originalBytes = Buffer.byteLength(result.output, "utf8");
  if (originalBytes <= maxBytes) return result;

  const classification = classifyMcpOutput(result.output);

  // 先尝试落盘；失败则回退旧行为。
  let filePath: string | null = null;
  try {
    const dumpDir = options.dumpDir ?? process.cwd();
    const resolvedDir = resolve(dumpDir);
    const stem = sanitizeMcpDumpStem(options.callId ?? "mcp-output");
    const candidate = resolve(join(resolvedDir, `${stem}.${classification.extension}`));
    if (candidate !== resolvedDir && !candidate.startsWith(resolvedDir + sep)) {
      throw new Error("mcp spill path escapes dump dir");
    }
    await mkdir(resolvedDir, { recursive: true });
    await writeFile(candidate, result.output, "utf8");
    filePath = candidate;
  } catch {
    return truncateMcpResultInline(result, maxBytes);
  }

  // 预算：total = prefix + suffix ≤ maxBytes（suffix 含路径与提示，先按占位数字估算再收敛一次）。
  let suffix = buildSpillSuffix(0, originalBytes, filePath, classification.hint);
  let budget = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
  let prefix = decodeUtf8Prefix(result.output, budget);
  let shownBytes = Buffer.byteLength(prefix, "utf8");
  suffix = buildSpillSuffix(shownBytes, originalBytes, filePath, classification.hint);
  if (shownBytes + Buffer.byteLength(suffix, "utf8") > maxBytes) {
    budget = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
    prefix = decodeUtf8Prefix(result.output, budget);
    shownBytes = Buffer.byteLength(prefix, "utf8");
    suffix = buildSpillSuffix(shownBytes, originalBytes, filePath, classification.hint);
  }

  return {
    ...result,
    output: prefix + suffix,
    meta: {
      ...(result.meta ?? {}),
      truncated: true,
      originalBytes,
      returnedBytes: Buffer.byteLength(prefix + suffix, "utf8"),
      maxBytes,
      spillPath: filePath,
      dumpKind: classification.kind,
    },
  };
}
