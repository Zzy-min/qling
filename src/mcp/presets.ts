// ============================================================
// 轻灵 - MCP 服务器预设（可 qling mcp add <id>）
// 预设为常见社区包；实际连接依赖本机 npx/网络
// ============================================================

export interface McpPreset {
  id: string;
  displayName: string;
  description: string;
  /** 写入 store 的 server 配置（不含 name 键） */
  server: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    enabled: boolean;
    transport?: "stdio" | "http";
    url?: string;
    headers?: Record<string, string>;
  };
  /** 需要用户额外提供的 env 键（仅提示，不写密钥） */
  requiredEnv?: string[];
  tags?: string[];
}

const PRESETS: Record<string, McpPreset> = {
  filesystem: {
    id: "filesystem",
    displayName: "Filesystem",
    description: "官方 filesystem MCP（工作区文件访问）。",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      enabled: true,
      transport: "stdio",
    },
    tags: ["local", "files"],
  },
  memory: {
    id: "memory",
    displayName: "Memory",
    description: "官方 memory MCP（知识图谱式记忆）。",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      enabled: true,
      transport: "stdio",
    },
    tags: ["memory"],
  },
  fetch: {
    id: "fetch",
    displayName: "Fetch",
    description: "官方 fetch MCP（HTTP 抓取）。仍受本机网络策略约束。",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-fetch"],
      enabled: true,
      transport: "stdio",
    },
    tags: ["network"],
  },
  git: {
    id: "git",
    displayName: "Git",
    description: "社区 git MCP（仓库操作辅助）。",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-git", "--repository", "."],
      enabled: true,
      transport: "stdio",
    },
    tags: ["git", "local"],
  },
  time: {
    id: "time",
    displayName: "Time",
    description: "官方 time MCP（时区/时间查询）。",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-time"],
      enabled: true,
      transport: "stdio",
    },
    tags: ["utility"],
  },
};

export function listMcpPresets(): McpPreset[] {
  return Object.values(PRESETS);
}

export function getMcpPreset(idOrAlias: string): McpPreset | undefined {
  const raw = String(idOrAlias ?? "").trim().toLowerCase();
  if (!raw) return undefined;
  if (PRESETS[raw]) return PRESETS[raw];
  return listMcpPresets().find(
    (p) => p.id === raw || p.displayName.toLowerCase() === raw
  );
}

export function formatMcpPresetTable(): string[] {
  return listMcpPresets().map(
    (p, i) =>
      `${String(i + 1).padStart(2, " ")}. ${p.id.padEnd(12)} ${p.displayName} — ${p.description}`
  );
}
