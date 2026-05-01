// ============================================================
// E2E: MCP HTTP Transport（完整连接 + 工具发现 + 工具调用）
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { MCPRegistry } from "../../dist/mcp/registry.js";

function createFakeMCPHttp() {
  const requestLog = [];

  const server = createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const msg = JSON.parse(body);
      requestLog.push(msg);

      if (msg.method === "initialize") {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "e2e-session" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: {} } }));
        return;
      }
      if (msg.method === "notifications/initialized") {
        res.writeHead(202, { "content-type": "application/json" });
        res.end();
        return;
      }
      if (msg.method === "tools/list") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: [
              { name: "echo", description: "Echo tool", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
            ],
          },
        }));
        return;
      }
      if (msg.method === "tools/call") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { content: [{ type: "text", text: "echo: " + msg.params.arguments.text }] },
        }));
        return;
      }
      res.writeHead(400);
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "unknown method" } }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        endpoint: `http://127.0.0.1:${addr.port}`,
        getRequestLog() { return requestLog; },
        close() { return new Promise((r) => server.close(() => r())); },
      });
    });
  });
}

test("e2e mcp http: connect, discover tools, call tool", async () => {
  const fake = await createFakeMCPHttp();

  try {
    const registry = new MCPRegistry();
    registry.registerServer({
      name: "e2e-http",
      command: "",
      args: [],
      enabled: true,
      transport: "http",
      url: fake.endpoint,
    });

    const results = await registry.connectAll();
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "connected");
    assert.equal(results[0].tools.length, 1);
    assert.equal(results[0].tools[0].name, "echo");

    // Verify tool discovery
    const allTools = registry.getAllTools();
    assert.equal(allTools.length, 1);
    assert.equal(allTools[0].serverName, "e2e-http");

    // Call tool
    const toolResult = await registry.callTool("e2e-http", "echo", { text: "hello world" });
    assert.equal(toolResult.is_error, false);
    assert.equal(toolResult.output, "echo: hello world");

    // Verify request log
    const log = fake.getRequestLog();
    assert.ok(log.length >= 4, `expected at least 4 requests, got ${log.length}`);
    assert.equal(log[0].method, "initialize");
    assert.equal(log[1].method, "notifications/initialized");
    assert.equal(log[2].method, "tools/list");
    assert.equal(log[3].method, "tools/call");

    // Verify server status
    assert.deepEqual(registry.getConnectedServers(), ["e2e-http"]);
    assert.deepEqual(registry.getStatus(), { "e2e-http": "connected" });

    await registry.disconnectAll();
  } finally {
    await fake.close();
  }
});

test("e2e mcp http: connection failure for unreachable url", async () => {
  const registry = new MCPRegistry();
  registry.registerServer({
    name: "e2e-unreachable",
    command: "",
    args: [],
    enabled: true,
    transport: "http",
    url: "http://127.0.0.1:1", // port 1 is unlikely to be listening
  });

  const results = await registry.connectAll();
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "failed");
  assert.ok(results[0].error, "should have error message");

  assert.deepEqual(registry.getConnectedServers(), []);
});
