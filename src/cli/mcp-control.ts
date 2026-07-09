// ============================================================
// 轻灵 - 顶层 qling mcp 子命令
// ============================================================

import {
  formatMcpPresetTable,
  getMcpPreset,
  listMcpPresets,
} from "../mcp/presets.js";
import {
  addMcpPresetToStore,
  defaultMcpStorePath,
  loadMcpStore,
  removeMcpFromStore,
} from "../mcp/store.js";
import { buildLocalMcpReport, formatLocalMcpReport } from "../mcp-report.js";
import type { QlingConfig } from "../config.js";

export async function handleMcpCli(
  subArgs: string[],
  options: {
    mcpConfig: QlingConfig["mcp"];
    env?: Record<string, string | undefined>;
    stateDir?: string;
  }
): Promise<number> {
  const env = options.env ?? process.env;
  const [subRaw, ...rest] = subArgs;
  const sub = (subRaw ?? "status").toLowerCase();

  if (sub === "help" || sub === "-h" || sub === "--help") {
    printHelp();
    return 0;
  }

  if (sub === "presets" || sub === "preset" || sub === "ls-presets") {
    console.log("");
    console.log("可用 MCP 预设（qling mcp add <id>）:");
    console.log("-----------------------------------------");
    for (const line of formatMcpPresetTable()) {
      console.log(line);
    }
    console.log("-----------------------------------------");
    console.log("说明: 预设使用 npx 拉取社区包；首次运行需网络。");
    console.log("");
    return 0;
  }

  if (sub === "list" || sub === "ls") {
    const store = await loadMcpStore(defaultMcpStorePath(options.stateDir));
    const names = Object.keys(store.servers).sort();
    console.log("");
    console.log("本机 MCP store (~/.qling/mcp-servers.json):");
    console.log("-----------------------------------------");
    if (names.length === 0) {
      console.log("(空) 使用 qling mcp add <preset> 添加");
    } else {
      for (const name of names) {
        const s = store.servers[name];
        console.log(
          `- ${name}: enabled=${s.enabled} transport=${s.transport ?? "stdio"} command=${s.command} preset=${s.preset ?? "-"}`
        );
      }
    }
    console.log("-----------------------------------------");
    console.log("");
    return 0;
  }

  if (sub === "add") {
    const presetId = rest[0];
    if (!presetId) {
      console.error("用法: qling mcp add <preset> [--name <serverName>]");
      return 2;
    }
    let name: string | undefined;
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === "--name" && rest[i + 1]) {
        name = rest[i + 1];
        i++;
      } else if (rest[i]?.startsWith("--name=")) {
        name = rest[i].slice("--name=".length);
      }
    }
    if (!getMcpPreset(presetId)) {
      console.error(`未知预设 '${presetId}'。运行: qling mcp presets`);
      return 2;
    }
    const result = await addMcpPresetToStore(presetId, {
      name,
      stateDir: options.stateDir,
    });
    console.log(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`);
    return result.ok ? 0 : 1;
  }

  if (sub === "remove" || sub === "rm" || sub === "delete") {
    const name = rest[0];
    if (!name) {
      console.error("用法: qling mcp remove <serverName>");
      return 2;
    }
    const result = await removeMcpFromStore(name, { stateDir: options.stateDir });
    console.log(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`);
    return result.ok ? 0 : 1;
  }

  // status / default: 合并后的可见配置摘要（env 优先）
  const store = await loadMcpStore(defaultMcpStorePath(options.stateDir));
  const report = buildLocalMcpReport(
    {
      ...options.mcpConfig,
      servers: {
        ...store.servers,
        ...options.mcpConfig.servers,
      },
    },
    env
  );
  console.log(formatLocalMcpReport(report).join("\n"));
  if (Object.keys(store.servers).length > 0) {
    console.log(`(store: ${defaultMcpStorePath(options.stateDir)}; presets: ${listMcpPresets().length})`);
  }
  return 0;
}

function printHelp(): void {
  console.log(`
qling mcp — 本地 MCP 配置

用法:
  qling mcp                 # 状态摘要（config + store）
  qling mcp status
  qling mcp list            # 仅本机 store
  qling mcp presets         # 可用预设
  qling mcp add <preset> [--name <serverName>]
  qling mcp remove <name>

预设示例:
  qling mcp add filesystem
  qling mcp add memory

边界:
  - 配置写入 ~/.qling/mcp-servers.json
  - 不保存 API 密钥
  - 首次 npx 拉取可能需要网络
`);
}
