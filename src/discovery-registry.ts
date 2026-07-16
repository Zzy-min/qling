// ============================================================
// 轻灵 - Discovery Registry (v0.3)
// 动态发现核心逻辑：支持本地目录扫描与远程 URL 拉取
// ============================================================

import * as fs from "fs/promises";
import * as path from "path";
import { existsSync } from "fs";
import axios from "axios";
import { createPublicKey, verify } from "node:crypto";
import type { DiscoveryManifest, DiscoverySource, DiscoveredItem } from "./discovery-types.js";
import type { ToolDefinition } from "./types.js";
import { guardConfigFromEnv, type GuardConfig } from "./config.js";
import { appendGuardAudit, checkUrlFetchPolicy } from "./guard.js";

export interface DiscoveryRegistryOptions {
  allowUnsigned?: boolean;
  guardConfig?: GuardConfig;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  trustedKeys?: Record<string, string>;
  requireSignature?: boolean;
}

const ENABLED_VALUES = new Set(["1", "true", "on", "yes"]);

function isExplicitlyEnabled(raw: unknown): boolean {
  return ENABLED_VALUES.has(String(raw ?? "").trim().toLowerCase());
}

function assertValidManifest(value: unknown): asserts value is DiscoveryManifest {
  if (!value || typeof value !== "object") {
    throw new Error("manifest must be an object");
  }
  const manifest = value as Partial<DiscoveryManifest>;
  for (const key of ["id", "name", "version"] as const) {
    if (typeof manifest[key] !== "string" || !manifest[key]!.trim()) {
      throw new Error(`manifest.${key} must be a non-empty string`);
    }
  }
  if (!new Set(["skill", "mcp", "bundle"]).has(String(manifest.type))) {
    throw new Error("manifest.type must be skill, mcp, or bundle");
  }
  if (manifest.tools !== undefined) {
    if (!Array.isArray(manifest.tools)) {
      throw new Error("manifest.tools must be an array");
    }
    for (const tool of manifest.tools) {
      if (!tool || typeof tool !== "object" || typeof tool.name !== "string" || !tool.name.trim()) {
        throw new Error("manifest tool name must be a non-empty string");
      }
    }
  }
}

export class DiscoveryRegistry {
  private items: Map<string, DiscoveredItem> = new Map();
  private sources: DiscoverySource[] = [];
  private allowUnsigned: boolean;
  private guardConfig: GuardConfig;
  private env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  private trustedKeys: Record<string, string>;
  private requireSignature: boolean;

  constructor(sources: DiscoverySource[] = [], options: DiscoveryRegistryOptions = {}) {
    this.sources = sources;
    this.env = options.env ?? process.env;
    this.allowUnsigned =
      options.allowUnsigned ?? isExplicitlyEnabled(this.env.QLING_DISCOVERY_ALLOW_UNSIGNED);
    this.guardConfig =
      options.guardConfig ?? guardConfigFromEnv(this.env as NodeJS.ProcessEnv);
    this.trustedKeys = options.trustedKeys ?? parseTrustedKeys(this.env.QLING_DISCOVERY_TRUSTED_KEYS);
    this.requireSignature =
      options.requireSignature ?? isExplicitlyEnabled(this.env.QLING_DISCOVERY_REQUIRE_SIGNATURE);
  }

  /**
   * 同步所有源
   */
  async syncAll(): Promise<void> {
    const tasks = this.sources.map(s => this.syncSource(s));
    await Promise.allSettled(tasks);
  }

  /**
   * 同步特定源
   */
  async syncSource(source: DiscoverySource): Promise<void> {
    try {
      if (source.requireApproval) {
        throw new Error("source requires approval, but no discovery approval callback is configured");
      }
      if (source.type === "local") {
        await this.syncLocal(source);
      } else {
        await this.syncRemote(source);
      }
    } catch (err) {
      console.error(`[Discovery] Failed to sync source ${source.id}: ${(err as Error).message}`);
    }
  }

  private async syncLocal(source: DiscoverySource): Promise<void> {
    if (!existsSync(source.uri)) return;

    const entries = await fs.readdir(source.uri, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const manifestPath = path.join(source.uri, entry.name, "manifest.json");
        if (existsSync(manifestPath)) {
          try {
            const raw = await fs.readFile(manifestPath, "utf-8");
            const manifest = JSON.parse(raw) as DiscoveryManifest;
            if (this.requireSignature && !verifyManifestSignature(manifest, this.trustedKeys)) {
              throw new Error("manifest signature is missing, unknown, or invalid");
            }
            this.registerItem(source.id, manifest);
          } catch (err) {
            console.error(`[Discovery] Invalid manifest in ${manifestPath}: ${(err as Error).message}`);
          }
        }
      }
    }
  }

  private async syncRemote(source: DiscoverySource): Promise<void> {
    try {
      let target: URL;
      try {
        target = new URL(source.uri);
      } catch {
        throw new Error(`invalid remote manifest URL: ${source.uri}`);
      }
      const decision = await checkUrlFetchPolicy(target, this.guardConfig, this.env);
      if (!decision.allowed) {
        await appendGuardAudit(this.guardConfig, {
          tool: "dynamic_discovery",
          action: "deny",
          category: decision.category,
          target: target.toString(),
          reason: decision.reason,
        });
        throw new Error(decision.reason ?? "network guard denied remote manifest");
      }
      const resp = await axios.get(source.uri, {
        timeout: 10_000,
        maxRedirects: 0,
        maxContentLength: 1024 * 1024,
        maxBodyLength: 1024 * 1024,
      });
      const manifest = resp.data;
      assertValidManifest(manifest);
      const signatureValid = verifyManifestSignature(manifest, this.trustedKeys);
      if (!signatureValid && !this.allowUnsigned) {
        throw new Error(
          "remote manifest signature is missing, unknown, or invalid; unsigned remote discovery remains disabled"
        );
      }
      this.registerItem(source.id, manifest);
    } catch (err) {
      throw new Error(`Remote fetch failed: ${(err as Error).message}`);
    }
  }

  private registerItem(sourceId: string, manifest: DiscoveryManifest): void {
    assertValidManifest(manifest);
    const id = manifest.id;
    this.items.set(id, {
      id,
      sourceId,
      manifest,
      status: "loaded",
      lastUpdated: Date.now(),
    });
  }

  /**
   * 获取所有发现的工具定义
   */
  getDiscoveredTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const item of this.items.values()) {
      if (item.status === "loaded" && item.manifest.tools) {
        tools.push(...item.manifest.tools);
      }
    }
    return tools;
  }

  /**
   * Manifest tool entries are metadata only until an executable handler or
   * MCP transport has been bound. Never advertise metadata-only tools to the model.
   */
  getExecutableTools(): ToolDefinition[] {
    return [];
  }

  /**
   * 获取所有发现的 MCP 服务器配置
   */
  getDiscoveredMCPServers(): Record<string, any> {
    const servers: Record<string, any> = {};
    for (const item of this.items.values()) {
      if (item.status === "loaded" && item.manifest.mcpServers) {
        Object.assign(servers, item.manifest.mcpServers);
      }
    }
    return servers;
  }

  getAllItems(): DiscoveredItem[] {
    return Array.from(this.items.values());
  }
}

function parseTrustedKeys(raw: unknown): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string")
        .map(([key, value]) => [key, String(value)])
    );
  } catch {
    return {};
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === "signature") continue;
      output[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return output;
  }
  return value;
}

export function canonicalManifestPayload(manifest: DiscoveryManifest): string {
  return JSON.stringify(canonical(manifest));
}

export function verifyManifestSignature(
  manifest: DiscoveryManifest,
  trustedKeys: Record<string, string>
): boolean {
  if (!manifest.signature || !manifest.publicKeyId) return false;
  const pem = trustedKeys[manifest.publicKeyId];
  if (!pem) return false;
  try {
    return verify(
      null,
      Buffer.from(canonicalManifestPayload(manifest), "utf8"),
      createPublicKey(pem),
      Buffer.from(manifest.signature, "base64")
    );
  } catch {
    return false;
  }
}
