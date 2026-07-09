import { buildLocalMcpReport, formatLocalMcpReport } from "../mcp-report.js";
import { formatMcpPresetTable } from "../mcp/presets.js";
import { defaultMcpStorePath, loadMcpStore } from "../mcp/store.js";
import { SlashCommand } from "./types.js";

function parseTimeoutEnv(name: string): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export const mcpCommand: SlashCommand = {
  name: "/mcp",
  aliases: ["/外部工具"],
  description: "查看本地 MCP 配置；提示 presets / add",
  usage: "/mcp [status|presets|list]",
  argumentHint: "[status|presets|list]",
  execute: async (args, context) => {
    const sub = (args[0] ?? "status").toLowerCase();

    if (sub === "presets" || sub === "preset") {
      context.writeLine("");
      context.writeLine("可用 MCP 预设:");
      context.writeLine("-----------------------------------------");
      for (const line of formatMcpPresetTable()) {
        context.writeLine(line);
      }
      context.writeLine("-----------------------------------------");
      context.writeLine("添加: qling mcp add <preset>");
      context.writeLine("");
      return;
    }

    if (sub === "list" || sub === "ls") {
      const store = await loadMcpStore(defaultMcpStorePath());
      const names = Object.keys(store.servers).sort();
      context.writeLine("");
      context.writeLine("本机 MCP store:");
      context.writeLine("-----------------------------------------");
      if (names.length === 0) {
        context.writeLine("(空) — qling mcp add filesystem");
      } else {
        for (const name of names) {
          const s = store.servers[name];
          context.writeLine(`- ${name}: ${s.command} ${(s.args ?? []).join(" ")}`);
        }
      }
      context.writeLine("-----------------------------------------");
      context.writeLine("");
      return;
    }

    const report = buildLocalMcpReport(
      {
        servers: {},
        connection_timeout_ms: parseTimeoutEnv("QLING_MCP_CONNECTION_TIMEOUT_MS"),
        call_timeout_ms: parseTimeoutEnv("QLING_MCP_CALL_TIMEOUT_MS"),
      },
      process.env
    );

    for (const line of formatLocalMcpReport(report)) {
      context.writeLine(line);
    }
    context.writeLine("提示: /mcp presets · qling mcp add <preset> · qling mcp list");
  },
};
