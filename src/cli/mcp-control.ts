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
  addCustomMcpToStore,
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
    const idOrName = rest[0];
    if (!idOrName) {
      console.error("用法: qling mcp add <preset> [--name <serverName>] | qling mcp add <name> <http|stdio> <url|command> [options]");
      return 2;
    }
    const transport = rest[1]?.toLowerCase();
    if (transport === "http" || transport === "stdio") {
      const parsed = parseCustomServer(idOrName, transport, rest.slice(2));
      if (!parsed.ok) {
        console.error(parsed.message);
        return 2;
      }
      const result = await addCustomMcpToStore(idOrName, parsed.server, {
        stateDir: options.stateDir,
      });
      console.log(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`);
      if (parsed.containsSecret) {
        console.warn("⚠️ 认证信息已写入本机 MCP store；请限制该文件的读取权限。");
      }
      return result.ok ? 0 : 1;
    }
    if (rest[1] && !rest[1].startsWith("-")) {
      console.error(`不支持的 MCP transport '${rest[1]}'；仅支持 http 或 stdio`);
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
    if (!getMcpPreset(idOrName)) {
      console.error(`未知预设 '${idOrName}'。运行: qling mcp presets`);
      return 2;
    }
    const result = await addMcpPresetToStore(idOrName, {
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
  qling mcp add <name> http <url> [--auth-type bearer --token <token>] [--header <name:value>] [--timeout <duration>]
  qling mcp add <name> stdio <command> [--args <arg>]... [--env <name=value>]... [--timeout <duration>]
  qling mcp remove <name>

预设示例:
  qling mcp add filesystem
  qling mcp add memory
  qling mcp add search http http://127.0.0.1:3001/mcp --auth-type bearer --token "\${MCP_TOKEN}" --timeout 30s
  qling mcp add local-tools stdio node --args server.mjs --args=--verbose

边界:
  - 配置写入 ~/.qling/mcp-servers.json
  - --token/--header 会写入本机 store；优先通过环境变量展开后传入
  - 首次 npx 拉取可能需要网络
`);
}

type CustomServerResult =
  | { ok: true; server: Parameters<typeof addCustomMcpToStore>[1]; containsSecret: boolean }
  | { ok: false; message: string };

function parseCustomServer(
  name: string,
  transport: "http" | "stdio",
  args: string[]
): CustomServerResult {
  const endpoint = args[0]?.trim();
  if (!endpoint) {
    return { ok: false, message: `用法: qling mcp add ${name} ${transport} <${transport === "http" ? "url" : "command"}> [options]` };
  }
  if (transport === "http") {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    } catch {
      return { ok: false, message: `无效 HTTP MCP URL: ${endpoint}` };
    }
  }

  const server: Parameters<typeof addCustomMcpToStore>[1] = {
    command: transport === "stdio" ? endpoint : "",
    args: [],
    enabled: true,
    transport,
    ...(transport === "http" ? { url: endpoint } : {}),
  };
  const headers: Record<string, string> = {};
  const env: Record<string, string> = {};
  let authType: string | undefined;
  let token: string | undefined;
  let timeout: number | undefined;
  let connectionTimeout: number | undefined;
  let callTimeout: number | undefined;
  let containsSecret = false;

  for (let i = 1; i < args.length; i++) {
    const current = args[i];
    const [flag, inline] = splitOption(current);
    const takeValue = (): string | undefined => {
      if (inline !== undefined) return inline;
      const value = args[i + 1];
      if (value !== undefined) i++;
      return value;
    };
    if (flag === "--args" || flag === "--arg") {
      if (transport !== "stdio") return { ok: false, message: `${flag} 仅适用于 stdio` };
      const value = takeValue();
      if (value === undefined) return { ok: false, message: `${flag} 缺少值` };
      server.args.push(value);
    } else if (flag === "--env") {
      if (transport !== "stdio") return { ok: false, message: "--env 仅适用于 stdio" };
      const value = takeValue();
      const pair = parsePair(value, "=");
      if (!pair) return { ok: false, message: "--env 需要 name=value" };
      env[pair[0]] = pair[1];
    } else if (flag === "--header") {
      if (transport !== "http") return { ok: false, message: "--header 仅适用于 http" };
      const value = takeValue();
      const pair = parsePair(value, ":");
      if (!pair) return { ok: false, message: "--header 需要 name:value" };
      headers[pair[0].toLowerCase()] = pair[1];
      containsSecret = true;
    } else if (flag === "--auth-type") {
      const value = takeValue();
      if (!value) return { ok: false, message: "--auth-type 缺少值" };
      authType = value.toLowerCase();
    } else if (flag === "--token") {
      token = takeValue();
      if (!token) return { ok: false, message: "--token 缺少值" };
      containsSecret = true;
    } else if (flag === "--timeout" || flag === "--connection-timeout" || flag === "--call-timeout") {
      const parsed = parseDuration(takeValue());
      if (parsed === undefined) return { ok: false, message: `${flag} 需要正数时长，例如 1500ms、30s 或 2m` };
      if (flag === "--timeout") timeout = parsed;
      else if (flag === "--connection-timeout") connectionTimeout = parsed;
      else callTimeout = parsed;
    } else {
      return { ok: false, message: `未知选项 '${current}'` };
    }
  }

  if (authType !== undefined || token !== undefined) {
    if (transport !== "http") return { ok: false, message: "认证选项仅适用于 http" };
    if (authType !== "bearer") return { ok: false, message: "--auth-type 当前仅支持 bearer" };
    if (!token) return { ok: false, message: "--auth-type bearer 需要 --token" };
    headers.authorization = `Bearer ${token}`;
  }
  if (Object.keys(headers).length > 0) server.headers = headers;
  if (Object.keys(env).length > 0) server.env = env;
  if (timeout !== undefined || connectionTimeout !== undefined) {
    server.connection_timeout_ms = connectionTimeout ?? timeout;
  }
  if (timeout !== undefined || callTimeout !== undefined) {
    server.call_timeout_ms = callTimeout ?? timeout;
  }
  return { ok: true, server, containsSecret };
}

function splitOption(value: string): [string, string | undefined] {
  const index = value.indexOf("=");
  return index > 0 ? [value.slice(0, index), value.slice(index + 1)] : [value, undefined];
}

function parsePair(value: string | undefined, separator: string): [string, string] | undefined {
  if (!value) return undefined;
  const index = value.indexOf(separator);
  if (index <= 0) return undefined;
  const key = value.slice(0, index).trim();
  const val = value.slice(index + separator.length).trim();
  return key && val ? [key, val] : undefined;
}

function parseDuration(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const factor = match[2]?.toLowerCase() === "m" ? 60_000 : match[2]?.toLowerCase() === "s" ? 1000 : 1;
  const milliseconds = Math.round(amount * factor);
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : undefined;
}
