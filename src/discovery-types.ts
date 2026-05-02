// ============================================================
// 轻灵 - Discovery Types (v0.3)
// 动态发现协议定义：Manifest 架构、本地与远程元数据
// ============================================================

import { ToolDefinition } from "./types.js";

/**
 * 远程或本地插件清单 (Manifest)
 */
export interface DiscoveryManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  /** 清单类型 */
  type: "skill" | "mcp" | "bundle";
  /** 工具定义列表 (可选) */
  tools?: ToolDefinition[];
  /** MCP 配置 (可选) */
  mcpServers?: Record<string, {
    command: string;
    args: string[];
    enabled: boolean;
  }>;
  /** 兼容的最低轻灵版本 */
  engines?: {
    qingling: string;
  };
  /** 签名摘要 (安全校验) */
  signature?: string;
}

/**
 * 发现源配置
 */
export interface DiscoverySource {
  id: string;
  /** 本地目录或远程 URL */
  uri: string;
  /** 源类型 */
  type: "local" | "remote";
  /** 自动更新间隔 (毫秒) */
  refreshInterval?: number;
  /** 是否需要审批加载 */
  requireApproval?: boolean;
}

/**
 * 已加载的发现项状态
 */
export interface DiscoveredItem {
  id: string;
  sourceId: string;
  manifest: DiscoveryManifest;
  status: "loaded" | "failed" | "pending";
  error?: string;
  lastUpdated: number;
}
