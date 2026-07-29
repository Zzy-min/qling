import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleMcpCli } from "../../dist/cli/mcp-control.js";
import { loadMcpStore } from "../../dist/mcp/store.js";

const mcpConfig = {
  servers: {},
  connection_timeout_ms: 10_000,
  call_timeout_ms: 30_000,
};

async function withTempState(run) {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-mcp-custom-"));
  try {
    await run(stateDir);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

async function runCli(args, options) {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await handleMcpCli(args, options);
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

test("mcp add stores a custom HTTP server with bearer auth and timeout", async () => {
  await withTempState(async (stateDir) => {
    const code = await runCli([
      "add",
      "search",
      "http",
      "http://127.0.0.1:3001/mcp",
      "--auth-type",
      "bearer",
      "--token",
      "test-token",
      "--timeout",
      "30s",
    ], { mcpConfig, stateDir });

    assert.equal(code, 0);
    const store = await loadMcpStore(join(stateDir, "mcp-servers.json"));
    assert.deepEqual(store.servers.search, {
      command: "",
      args: [],
      enabled: true,
      transport: "http",
      url: "http://127.0.0.1:3001/mcp",
      headers: { authorization: "Bearer test-token" },
      connection_timeout_ms: 30_000,
      call_timeout_ms: 30_000,
      addedAt: store.servers.search.addedAt,
    });
  });
});

test("mcp add stores a custom STDIO server and repeated args", async () => {
  await withTempState(async (stateDir) => {
    const code = await runCli([
      "add",
      "local-tools",
      "stdio",
      "node",
      "--args",
      "server.mjs",
      "--args=--config=config.json",
      "--timeout=1500ms",
    ], { mcpConfig, stateDir });

    assert.equal(code, 0);
    const store = await loadMcpStore(join(stateDir, "mcp-servers.json"));
    assert.equal(store.servers["local-tools"].command, "node");
    assert.deepEqual(store.servers["local-tools"].args, [
      "server.mjs",
      "--config=config.json",
    ]);
    assert.equal(store.servers["local-tools"].connection_timeout_ms, 1500);
    assert.equal(store.servers["local-tools"].call_timeout_ms, 1500);
  });
});

test("mcp add rejects invalid custom transport and timeout", async () => {
  await withTempState(async (stateDir) => {
    assert.equal(
      await runCli(["add", "custom", "websocket", "ws://localhost"], {
        mcpConfig,
        stateDir,
      }),
      2,
    );
    assert.equal(
      await runCli(["add", "custom", "http", "http://localhost", "--timeout", "forever"], {
        mcpConfig,
        stateDir,
      }),
      2,
    );
    assert.equal(
      await runCli(["add", "__proto__", "http", "http://localhost"], {
        mcpConfig,
        stateDir,
      }),
      1,
    );
    assert.equal(
      await runCli(["add", "custom", "http", "http://localhost", "--token"], {
        mcpConfig,
        stateDir,
      }),
      2,
    );
  });
});
