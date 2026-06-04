import test from "node:test";
import assert from "node:assert/strict";

import { buildLocalMcpReport, formatLocalMcpReport, sanitizeMcpUrl } from "../../dist/mcp-report.js";

test("mcp report handles empty server list", () => {
  const report = buildLocalMcpReport({
    servers: {},
    connection_timeout_ms: 10000,
    call_timeout_ms: 30000,
  });
  const text = formatLocalMcpReport(report).join("\n");

  assert.match(text, /本地 MCP 配置/);
  assert.match(text, /Servers\s*: enabled=0\/0/);
  assert.match(text, /\(无 MCP server\)/);
  assert.match(text, /不连接 server/);
});

test("mcp report lists stdio server and redacts env values", () => {
  const report = buildLocalMcpReport({
    servers: {
      github: {
        command: "node",
        args: ["server.js", "--token", "SHOULD_NOT_BE_TREATED_AS_SECRET_ARG"],
        env: {
          GITHUB_TOKEN: "ghp_secret_value",
          SAFE_FLAG: "true",
        },
        enabled: true,
        transport: "stdio",
      },
    },
    connection_timeout_ms: 5000,
    call_timeout_ms: 6000,
  });
  const text = formatLocalMcpReport(report).join("\n");

  assert.match(text, /Servers\s*: enabled=1\/1/);
  assert.match(text, /github/);
  assert.match(text, /transport=stdio/);
  assert.match(text, /command=node/);
  assert.match(text, /args=server\.js --token SHOULD_NOT_BE_TREATED_AS_SECRET_ARG/);
  assert.match(text, /GITHUB_TOKEN=set\(redacted\)/);
  assert.match(text, /SAFE_FLAG=set\(redacted\)/);
  assert.doesNotMatch(text, /ghp_secret_value/);
});

test("mcp report lists http server and redacts url/header values", () => {
  const report = buildLocalMcpReport({
    servers: {
      docs: {
        command: "",
        args: [],
        enabled: false,
        transport: "http",
        url: "https://user:pass@example.com/mcp?token=abc#frag",
        headers: {
          Authorization: "Bearer secret",
          "X-Api-Key": "secret-key",
        },
      },
    },
    connection_timeout_ms: 7000,
    call_timeout_ms: 8000,
  });
  const text = formatLocalMcpReport(report).join("\n");

  assert.match(text, /enabled=false/);
  assert.match(text, /transport=http/);
  assert.match(text, /url=https:\/\/example\.com\/mcp/);
  assert.match(text, /Authorization=set\(redacted\)/);
  assert.match(text, /X-Api-Key=set\(redacted\)/);
  assert.doesNotMatch(text, /Bearer secret/);
  assert.doesNotMatch(text, /secret-key/);
  assert.doesNotMatch(text, /user:pass/);
  assert.doesNotMatch(text, /token=abc/);
});

test("mcp url sanitizer strips userinfo query and hash", () => {
  assert.equal(sanitizeMcpUrl("https://u:p@example.com/a?token=x#frag"), "https://example.com/a");
  assert.equal(sanitizeMcpUrl(""), "-");
});

test("mcp report accepts QINGLING_MCP_SERVERS env override for local visibility", () => {
  const report = buildLocalMcpReport(
    {
      servers: {},
      connection_timeout_ms: 10000,
      call_timeout_ms: 30000,
    },
    {
      QINGLING_MCP_SERVERS: JSON.stringify({
        envServer: {
          command: "",
          args: [],
          enabled: true,
          transport: "http",
          url: "https://example.com/mcp?token=secret",
          headers: { Authorization: "Bearer secret" },
        },
      }),
    }
  );
  const text = formatLocalMcpReport(report).join("\n");

  assert.match(text, /enabled=1\/1/);
  assert.match(text, /envServer/);
  assert.match(text, /Authorization=set\(redacted\)/);
  assert.doesNotMatch(text, /Bearer secret/);
  assert.doesNotMatch(text, /token=secret/);
});
