// ============================================================
// 轻灵 - Discovery Registry (v0.3)
// 动态发现核心逻辑：支持本地目录扫描与远程 URL 拉取
// ============================================================

import * as fs from "fs/promises";
import * as path from "path";
import { existsSync } from "fs";
import axios from "axios";
import { DiscoveryManifest, DiscoverySource, DiscoveredItem } from "./discovery-types.js";
import { ToolDefinition } from "./types.js";

export class DiscoveryRegistry {
  private items: Map<string, DiscoveredItem> = new Map();
  private sources: DiscoverySource[] = [];

  constructor(sources: DiscoverySource[] = []) {
    this.sources = sources;
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
      const resp = await axios.get(source.uri, { timeout: 10000 });
      const manifest = resp.data as DiscoveryManifest;
      // TODO: 签名校验
      this.registerItem(source.id, manifest);
    } catch (err) {
      throw new Error(`Remote fetch failed: ${(err as Error).message}`);
    }
  }

  private registerItem(sourceId: string, manifest: DiscoveryManifest): void {
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
