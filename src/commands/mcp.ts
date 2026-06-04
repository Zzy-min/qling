import { buildLocalMcpReport, formatLocalMcpReport } from "../mcp-report.js";
import { SlashCommand } from "./types.js";

function parseTimeoutEnv(name: string): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export const mcpCommand: SlashCommand = {
  name: "/mcp",
  aliases: ["/外部工具"],
  description: "查看本地 MCP server 配置摘要",
  usage: "/mcp",
  execute: async (_args, context) => {
    const report = buildLocalMcpReport(
      {
        servers: {},
        connection_timeout_ms: parseTimeoutEnv("QINGLING_MCP_CONNECTION_TIMEOUT_MS"),
        call_timeout_ms: parseTimeoutEnv("QINGLING_MCP_CALL_TIMEOUT_MS"),
      },
      process.env
    );

    for (const line of formatLocalMcpReport(report)) {
      context.writeLine(line);
    }
  },
};
