import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyConfigToProcessEnv, loadQinglingConfig } from "../../dist/config.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "qingling-config-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withEnv(patch, fn) {
  const prev = {};
  for (const key of Object.keys(patch)) {
    prev[key] = process.env[key];
    const value = patch[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

test("config precedence: CLI > ENV > config file > defaults", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "qingling.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        llm: { model: "from-file" },
      }),
      "utf-8"
    );

    await withEnv({ QINGLING_LLM_MODEL: "from-env" }, async () => {
      const loaded = await loadQinglingConfig({
        configPath,
        model: "from-cli",
      });
      assert.equal(loaded.config.llm.model, "from-cli");
    });
  });
});

test("config supports ${ENV_VAR} template expansion with warnings", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "qingling.config.yaml");
    await writeFile(
      configPath,
      "llm:\n  api_key: ${MY_TEST_KEY}\nruntime:\n  workspace_dir: ${MISSING_KEY}\n",
      "utf-8"
    );
    await withEnv({ MY_TEST_KEY: "abc-123", MISSING_KEY: undefined }, async () => {
      const loaded = await loadQinglingConfig({ configPath });
      assert.equal(loaded.config.llm.api_key, "abc-123");
      assert.match(loaded.warnings.join("\n"), /Missing env variable/);
    });
  });
});

test("config cli noWorkspace overrides workspace root", async () => {
  const loaded = await loadQinglingConfig({ noWorkspace: true });
  assert.equal(loaded.config.runtime.workspace_dir, null);
});

test("config: explicit missing config path throws", async () => {
  await assert.rejects(() =>
    loadQinglingConfig({
      configPath: join(process.cwd(), "definitely-not-exist-config.json"),
    })
  );
});

test("applyConfigToProcessEnv maps memory/mcp/metrics/channels fields", async () => {
  const loaded = await loadQinglingConfig({});
  applyConfigToProcessEnv(loaded.config);

  assert.equal(process.env.QINGLING_MEMORY_WAL_ENABLED, String(loaded.config.memory.wal_enabled));
  assert.equal(
    process.env.QINGLING_MEMORY_PROJECTION_INTERVAL_MS,
    String(loaded.config.memory.projection_interval_ms)
  );
  assert.equal(process.env.QINGLING_MCP_SERVERS, JSON.stringify(loaded.config.mcp.servers));
  assert.equal(process.env.QINGLING_METRICS_ENABLED, String(loaded.config.metrics.enabled));
  assert.equal(process.env.QINGLING_CHANNEL_DEFAULT, loaded.config.channels.default);
});
