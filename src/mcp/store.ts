// ============================================================
// 轻灵 - 本机 MCP server 配置存储 (~/.qling/mcp-servers.json)
// ============================================================

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import type { McpPreset } from "./presets.js";
import { getMcpPreset } from "./presets.js";

export interface StoredMcpServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  transport?: "stdio" | "http";
  url?: string;
  headers?: Record<string, string>;
  /** 来源 preset id（若有） */
  preset?: string;
  addedAt?: string;
}

export interface McpStoreFile {
  version: 1;
  servers: Record<string, StoredMcpServer>;
}

export function defaultMcpStorePath(stateDir?: string): string {
  const root = stateDir
    ? path.resolve(stateDir)
    : path.join(os.homedir(), ".qling");
  return path.join(root, "mcp-servers.json");
}

export async function loadMcpStore(storePath?: string): Promise<McpStoreFile> {
  const file = storePath ?? defaultMcpStorePath();
  try {
    if (!existsSync(file)) {
      return { version: 1, servers: {} };
    }
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as McpStoreFile;
    if (!parsed || typeof parsed !== "object" || !parsed.servers) {
      return { version: 1, servers: {} };
    }
    return {
      version: 1,
      servers: parsed.servers ?? {},
    };
  } catch {
    return { version: 1, servers: {} };
  }
}

export async function saveMcpStore(
  store: McpStoreFile,
  storePath?: string
): Promise<string> {
  const file = storePath ?? defaultMcpStorePath();
  await mkdir(path.dirname(file), { recursive: true });
  const payload: McpStoreFile = {
    version: 1,
    servers: store.servers,
  };
  await writeFile(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return file;
}

export async function addMcpPresetToStore(
  presetId: string,
  options: { name?: string; storePath?: string; stateDir?: string } = {}
): Promise<{ ok: boolean; name: string; message: string; storePath: string }> {
  const preset = getMcpPreset(presetId);
  const storePath = options.storePath ?? defaultMcpStorePath(options.stateDir);
  if (!preset) {
    return {
      ok: false,
      name: "",
      message: `未知 MCP 预设 '${presetId}'。运行 qling mcp presets 查看。`,
      storePath,
    };
  }
  const name = (options.name ?? preset.id).trim();
  if (!name) {
    return { ok: false, name: "", message: "server 名称不能为空", storePath };
  }

  const store = await loadMcpStore(storePath);
  store.servers[name] = {
    ...preset.server,
    env: preset.server.env ? { ...preset.server.env } : undefined,
    args: [...preset.server.args],
    preset: preset.id,
    addedAt: new Date().toISOString(),
  };
  await saveMcpStore(store, storePath);

  const envHint =
    preset.requiredEnv && preset.requiredEnv.length > 0
      ? ` 需要环境变量: ${preset.requiredEnv.join(", ")}`
      : "";

  return {
    ok: true,
    name,
    message: `已添加 MCP server '${name}' (preset=${preset.id}) → ${storePath}.${envHint}`,
    storePath,
  };
}

export async function removeMcpFromStore(
  name: string,
  options: { storePath?: string; stateDir?: string } = {}
): Promise<{ ok: boolean; message: string }> {
  const storePath = options.storePath ?? defaultMcpStorePath(options.stateDir);
  const store = await loadMcpStore(storePath);
  if (!store.servers[name]) {
    return { ok: false, message: `store 中不存在 server '${name}'` };
  }
  delete store.servers[name];
  await saveMcpStore(store, storePath);
  return { ok: true, message: `已移除 MCP server '${name}'` };
}

/** 将 store 合并进 config.servers（不覆盖已有同名；env JSON 仍优先于调用方） */
export function mergeMcpServers(
  base: Record<string, StoredMcpServer>,
  store: McpStoreFile
): Record<string, StoredMcpServer> {
  return { ...store.servers, ...base };
}

export function presetToStored(preset: McpPreset): StoredMcpServer {
  return {
    ...preset.server,
    args: [...preset.server.args],
    env: preset.server.env ? { ...preset.server.env } : undefined,
    preset: preset.id,
  };
}
