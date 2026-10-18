// ============================================================
// MCP 输出落盘（spill）+ per-server 上限 单元测试
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:http";

import { spillMcpResult, sanitizeMcpDumpStem, MCPRegistry } from "../../dist/mcp/registry.js";
import {
  runWithRuntimeExecutionIdentity,
  runWithRuntimeRoots,
} from "../../dist/runtime-paths.js";

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "qling-mcp-spill-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function inlinePrefix(output) {
  const marker = "\n[MCP 输出已截断：";
  const idx = output.indexOf(marker);
  return idx === -1 ? output : output.slice(0, idx);
}

describe("spillMcpResult", () => {
  it("spills oversized output to disk and keeps an inline pointer with hint", async () => {
    await withTempDir(async (root) => {
      const dumpDir = join(root, "sessions", "s1", "mcp");
      const payload = JSON.stringify({
        items: Array.from({ length: 400 }, (_, i) => ({ id: i, blob: "y".repeat(300) })),
      });
      assert.ok(Buffer.byteLength(payload, "utf8") > 100 * 1024);

      const result = await spillMcpResult(
        { tool_call_id: "mcp__demo__big", output: payload, is_error: false },
        { maxBytes: 20 * 1024, dumpDir, callId: "demo__big" }
      );

      const spillPath = result.meta.spillPath;
      assert.equal(typeof spillPath, "string");
      assert.ok(result.output.includes("MCP 输出已截断"), "inline truncation marker");
      assert.ok(result.output.includes(spillPath), "inline carries the spill path");
      assert.ok(result.output.includes("jq"), "JSON hint mentions jq");
      assert.ok(result.output.includes("node"), "long-line JSON hint mentions node");
      assert.equal(result.meta.truncated, true);
      assert.ok(Buffer.byteLength(result.output, "utf8") <= 20 * 1024 + 512);

      // 落盘文件与原文完全一致
      const onDisk = await readFile(spillPath, "utf8");
      assert.equal(onDisk, payload);

      // 用 node 读回某个字段
      const parsed = JSON.parse(onDisk);
      assert.equal(parsed.items[7].id, 7);
    });
  });

  it("does not truncate output exactly at the limit", async () => {
    await withTempDir(async (root) => {
      const payload = "x".repeat(4096);
      const result = await spillMcpResult(
        { tool_call_id: "t", output: payload, is_error: false },
        { maxBytes: 4096, dumpDir: join(root, "dump"), callId: "at-limit" }
      );
      assert.equal(result.output, payload);
      assert.equal(result.meta, undefined);
    });
  });

  it("sanitizes callId so the spill path cannot escape dumpDir", async () => {
    await withTempDir(async (root) => {
      const dumpDir = join(root, "dump");
      const result = await spillMcpResult(
        { tool_call_id: "t", output: "z".repeat(9999), is_error: false },
        { maxBytes: 1024, dumpDir, callId: "../../etc/evil" }
      );
      const spillPath = resolve(result.meta.spillPath);
      const resolvedDir = resolve(dumpDir);
      assert.ok(
        spillPath.startsWith(resolvedDir + sep),
        `spill path ${spillPath} must stay inside ${resolvedDir}`
      );
      assert.equal(sanitizeMcpDumpStem("../../etc/evil").includes("."), false);
      assert.equal(sanitizeMcpDumpStem(""), "mcp-output");
    });
  });

  it("keeps UTF-8 boundaries intact for multibyte text", async () => {
    await withTempDir(async (root) => {
      const dumpDir = join(root, "dump");
      const payload = "中".repeat(5000); // 15000 bytes, no trailing newline
      const result = await spillMcpResult(
        { tool_call_id: "t", output: payload, is_error: false },
        { maxBytes: 1000, dumpDir, callId: "cjk" }
      );
      assert.equal(result.output.includes("\uFFFD"), false, "no replacement characters");
      const prefix = inlinePrefix(result.output);
      assert.ok(prefix.length > 0);
      assert.ok(payload.startsWith(prefix), "prefix is a clean cut of the original");
      assert.equal(await readFile(result.meta.spillPath, "utf8"), payload);
    });
  });

  it("falls back to inline truncation when the spill write fails", async () => {
    await withTempDir(async (root) => {
      // dumpDir 指向一个普通文件 → mkdir 失败
      const blocker = join(root, "not-a-dir");
      await writeFile(blocker, "x");
      const result = await spillMcpResult(
        { tool_call_id: "t", output: "q".repeat(9999), is_error: false },
        { maxBytes: 1024, dumpDir: join(blocker, "nested"), callId: "fail" }
      );
      assert.equal(result.meta.truncated, true);
      assert.equal(result.meta.spillPath, undefined);
      assert.ok(result.output.includes("MCP output truncated by byte budget"));
      assert.ok(result.output.length < 9999);
    });
  });
});

// --- per-server max_output_bytes 的端到端验证（HTTP transport） ---

function createFakeMcpHttpServer(callText) {
  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      const msg = JSON.parse(body);
      if (msg.method === "initialize") {
        res.setHeader("mcp-session-id", "spill-session");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: {} } }));
        return;
      }
      if (msg.method === "notifications/initialized") {
        res.writeHead(202);
        res.end();
        return;
      }
      if (msg.method === "tools/list") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { tools: [{ name: "echo", description: "echo", inputSchema: { type: "object", properties: {} } }] },
          })
        );
        return;
      }
      if (msg.method === "tools/call") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { content: [{ type: "text", text: callText }] },
          })
        );
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
    });
  });
  return new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", () => {
      resolveListen({
        endpoint: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe("MCPRegistry per-server max_output_bytes", () => {
  it("applies the per-server limit over the global default", async () => {
    const big = "A".repeat(5000);
    const fake = await createFakeMcpHttpServer(big);
    try {
      await withTempDir(async (root) => {
        const registry = new MCPRegistry({ connection: 3000, call: 3000, maxOutputBytes: 20 * 1024 });
        registry.registerServer({
          name: "small",
          command: "",
          args: [],
          enabled: true,
          transport: "http",
          url: fake.endpoint,
          max_output_bytes: 1024,
        });
        registry.registerServer({
          name: "default",
          command: "",
          args: [],
          enabled: true,
          transport: "http",
          url: fake.endpoint,
        });
        await registry.connectAll();

        const roots = { workspaceDir: root, fileCacheDir: root, fileStateDir: root };
        const { small, normal } = await runWithRuntimeRoots(roots, () =>
          runWithRuntimeExecutionIdentity({ sessionId: "s-per" }, async () => {
            const s = await registry.callTool("small", "echo", {});
            const n = await registry.callTool("default", "echo", {});
            return { small: s, normal: n };
          })
        );

        assert.equal(small.meta?.truncated, true);
        assert.equal(typeof small.meta?.spillPath, "string");
        assert.ok(resolve(small.meta.spillPath).startsWith(resolve(join(root, "sessions", "s-per", "mcp")) + sep));
        assert.equal(normal.meta, undefined);
        assert.equal(normal.output, big);

        await registry.disconnectAll();
      });
    } finally {
      await fake.close();
    }
  });
});
