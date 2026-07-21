// ============================================================
// MCP HTTP Transport 单元测试
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { MCPClient } from "../../dist/mcp/client.js";
import { HttpTransport } from "../../dist/mcp/http-transport.js";

function createFakeMCPHttpServer(handler) {
  const requestLog = [];
  let sessionId = "test-session-123";

  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }

    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const msg = JSON.parse(body);
        requestLog.push({ msg, headers: { ...req.headers } });

        const response = handler(msg, requestLog.length - 1);

        // Set Mcp-Session-Id on initialize response
        if (msg.method === "initialize") {
          res.setHeader("mcp-session-id", sessionId);
        }

        if (response === null) {
          // 202 Accepted for notifications
          res.writeHead(202, { "content-type": "application/json" });
          res.end();
          return;
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(response));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const endpoint = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        endpoint,
        getRequestLog() { return requestLog; },
        close() { return new Promise((r) => server.close(() => r())); },
      });
    });
  });
}

describe("MCP HTTP Transport", () => {
  it("rejects a JSON 401 before delivering it as an MCP message", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { tools: [{ name: "must-not-be-delivered" }] },
        detail: "Bearer server-secret",
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    try {
      const transport = new HttpTransport(endpoint, undefined, 1000);
      let delivered = false;
      transport.onMessage(() => { delivered = true; });
      await assert.rejects(
        transport.send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
        (error) => {
          assert.match(error.message, /MCP HTTP 401/);
          assert.doesNotMatch(error.message, /server-secret/);
          return true;
        }
      );
      assert.equal(delivered, false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("should complete handshake: initialize → tools/list", async () => {
    const fake = await createFakeMCPHttpServer((msg, idx) => {
      if (msg.method === "initialize") {
        return { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: {} } };
      }
      if (msg.method === "notifications/initialized") {
        return null; // 202
      }
      if (msg.method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: [
              { name: "test_tool", description: "A test tool", inputSchema: { type: "object", properties: {} } },
            ],
          },
        };
      }
      return { jsonrpc: "2.0", id: msg.id, result: {} };
    });

    try {
      const client = new MCPClient({
        name: "test-http",
        command: "",
        args: [],
        enabled: true,
        transport: "http",
        url: fake.endpoint,
      });

      const result = await client.connect();
      assert.equal(result.status, "connected");
      assert.equal(result.tools.length, 1);
      assert.equal(result.tools[0].name, "test_tool");

      const log = fake.getRequestLog();
      assert.equal(log.length, 3); // initialize, notifications/initialized, tools/list
      assert.equal(log[0].msg.method, "initialize");
      assert.equal(log[1].msg.method, "notifications/initialized");
      assert.equal(log[2].msg.method, "tools/list");

      await client.disconnect();
    } finally {
      await fake.close();
    }
  });

  it("should pass Mcp-Session-Id header on subsequent requests", async () => {
    const fake = await createFakeMCPHttpServer((msg) => {
      if (msg.method === "initialize") {
        return { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: {} } };
      }
      if (msg.method === "notifications/initialized") return null;
      if (msg.method === "tools/list") {
        return { jsonrpc: "2.0", id: msg.id, result: { tools: [] } };
      }
      return { jsonrpc: "2.0", id: msg.id, result: {} };
    });

    try {
      const client = new MCPClient({
        name: "test-session",
        command: "",
        args: [],
        enabled: true,
        transport: "http",
        url: fake.endpoint,
      });

      await client.connect();

      const log = fake.getRequestLog();
      // First request (initialize) should not have session id
      assert.equal(log[0].headers["mcp-session-id"], undefined);
      // Subsequent requests should have session id
      assert.equal(log[1].headers["mcp-session-id"], "test-session-123");
      assert.equal(log[2].headers["mcp-session-id"], "test-session-123");

      await client.disconnect();
    } finally {
      await fake.close();
    }
  });

  it("should handle SSE response", async () => {
    const fake = await new Promise((resolve) => {
      const requestLog = [];
      const server = createServer((req, res) => {
        if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => {
          const msg = JSON.parse(body);
          requestLog.push(msg);

          if (msg.method === "initialize") {
            res.setHeader("mcp-session-id", "sse-session");
            res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
            res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: {} } })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (msg.method === "notifications/initialized") {
            res.writeHead(202, { "content-type": "application/json" });
            res.end();
            return;
          }
          if (msg.method === "tools/list") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } }));
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve({ server, endpoint: `http://127.0.0.1:${addr.port}`, getRequestLog: () => requestLog, close: () => new Promise((r) => server.close(() => r())) });
      });
    });

    try {
      const client = new MCPClient({
        name: "test-sse",
        command: "",
        args: [],
        enabled: true,
        transport: "http",
        url: fake.endpoint,
      });

      const result = await client.connect();
      assert.equal(result.status, "connected");
      assert.equal(fake.getRequestLog().length, 3);

      await client.disconnect();
    } finally {
      await fake.close();
    }
  });

  it("should call tool via HTTP transport", async () => {
    const fake = await createFakeMCPHttpServer((msg) => {
      if (msg.method === "initialize") {
        return { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: {} } };
      }
      if (msg.method === "notifications/initialized") return null;
      if (msg.method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id: msg.id,
          result: { tools: [{ name: "echo", description: "echo tool", inputSchema: {} }] },
        };
      }
      if (msg.method === "tools/call") {
        return {
          jsonrpc: "2.0",
          id: msg.id,
          result: { content: [{ type: "text", text: "echo: " + msg.params.arguments.text }] },
        };
      }
      return { jsonrpc: "2.0", id: msg.id, result: {} };
    });

    try {
      const client = new MCPClient({
        name: "test-call",
        command: "",
        args: [],
        enabled: true,
        transport: "http",
        url: fake.endpoint,
      });

      await client.connect();
      const toolResult = await client.callTool("echo", { text: "hello" });

      assert.equal(toolResult.is_error, false);
      assert.equal(toolResult.output, "echo: hello");

      await client.disconnect();
    } finally {
      await fake.close();
    }
  });

  it("should return error for missing url on http transport", async () => {
    const client = new MCPClient({
      name: "test-no-url",
      command: "",
      args: [],
      enabled: true,
      transport: "http",
      // url missing
    });

    const result = await client.connect();
    assert.equal(result.status, "failed");
    assert.match(result.error, /url/i);
  });

  it("should call tool with custom headers", async () => {
    const fake = await createFakeMCPHttpServer((msg, idx) => {
      if (msg.method === "initialize") {
        return { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: {} } };
      }
      if (msg.method === "notifications/initialized") return null;
      if (msg.method === "tools/list") return { jsonrpc: "2.0", id: msg.id, result: { tools: [] } };
      return { jsonrpc: "2.0", id: msg.id, result: {} };
    });

    try {
      const client = new MCPClient({
        name: "test-headers",
        command: "",
        args: [],
        enabled: true,
        transport: "http",
        url: fake.endpoint,
        headers: { "authorization": "Bearer test-token" },
      });

      await client.connect();

      const log = fake.getRequestLog();
      assert.equal(log[0].headers["authorization"], "Bearer test-token");

      await client.disconnect();
    } finally {
      await fake.close();
    }
  });
});
