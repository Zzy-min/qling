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

test("config supports legacy runtime env aliases for workspace/cache/state dirs", async () => {
  const workspaceDir = process.cwd();
  const stateDir = join(workspaceDir, ".tmp-state");
  const cacheDir = join(stateDir, "cache-custom");
  await withEnv(
    {
      QINGLING_WORKSPACE_DIR: workspaceDir,
      QINGLING_FILE_CACHE_DIR: cacheDir,
      QINGLING_FILE_STATE_DIR: stateDir,
    },
    async () => {
      const loaded = await loadQinglingConfig({});
      assert.equal(loaded.config.runtime.workspace_dir, workspaceDir);
      assert.equal(loaded.config.runtime.file_cache_dir, cacheDir);
      assert.equal(loaded.config.runtime.file_state_dir, stateDir);
    }
  );
});

test("config supports permissions.mode compatibility from config file", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "qingling.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        permissions: { mode: "deny" },
      }),
      "utf-8"
    );
    const loaded = await loadQinglingConfig({ configPath });
    assert.equal(loaded.config.guard.permissions.default, "deny");
  });
});

test("config supports QINGLING_PERMISSIONS_MODE env alias", async () => {
  await withEnv(
    {
      QINGLING_PERMISSIONS_MODE: "ask",
      QINGLING_GUARD_PERMISSIONS_DEFAULT: undefined,
    },
    async () => {
      const loaded = await loadQinglingConfig({});
      assert.equal(loaded.config.guard.permissions.default, "ask");
    }
  );
});

test("config supports QINGLING_GUARD_CONTENT_FILTER_CUSTOM env alias", async () => {
  await withEnv(
    {
      QINGLING_GUARD_CONTENT_FILTER_CUSTOM: JSON.stringify(["SECRET_CUSTOM_ALIAS"]),
      QINGLING_GUARD_CONTENT_FILTER_CUSTOM_PATTERNS: undefined,
    },
    async () => {
      const loaded = await loadQinglingConfig({});
      assert.deepEqual(loaded.config.guard.content_filter.custom_patterns, ["SECRET_CUSTOM_ALIAS"]);
    }
  );
});

test("config supports agents.isolation fields from config file", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "qingling.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        agents: {
          isolation: {
            mode: "off",
            require_git: false,
            non_git_policy: "off",
          },
        },
      }),
      "utf-8"
    );
    const loaded = await loadQinglingConfig({ configPath });
    assert.equal(loaded.config.agents.isolation.mode, "off");
    assert.equal(loaded.config.agents.isolation.require_git, false);
    assert.equal(loaded.config.agents.isolation.non_git_policy, "off");
  });
});

test("config supports agents isolation env aliases", async () => {
  await withEnv(
    {
      QINGLING_AGENTS_ISOLATION_MODE: "off",
      QINGLING_AGENTS_ISOLATION_REQUIRE_GIT: "false",
      QINGLING_AGENTS_ISOLATION_NON_GIT_POLICY: "deny",
    },
    async () => {
      const loaded = await loadQinglingConfig({});
      assert.equal(loaded.config.agents.isolation.mode, "off");
      assert.equal(loaded.config.agents.isolation.require_git, false);
      assert.equal(loaded.config.agents.isolation.non_git_policy, "deny");
    }
  );
});

test("config: explicit missing config path throws", async () => {
  await assert.rejects(() =>
    loadQinglingConfig({
      configPath: join(process.cwd(), "definitely-not-exist-config.json"),
    })
  );
});

test("applyConfigToProcessEnv maps memory/mcp/metrics/channels and guard fields", async () => {
  const loaded = await loadQinglingConfig({});
  loaded.config.guard.rate_limit.enabled = true;
  loaded.config.guard.rate_limit.max_per_minute = 17;
  loaded.config.guard.content_filter.enabled = true;
  loaded.config.guard.content_filter.pii_detection = true;
  loaded.config.guard.content_filter.injection_detection = false;
  loaded.config.guard.content_filter.custom_patterns = ["SECRET_CONFIG_PATTERN"];
  loaded.config.guard.permissions.rules = [{ tool_pattern: "bash", decision: "ask" }];
  applyConfigToProcessEnv(loaded.config);

  assert.equal(process.env.QINGLING_MEMORY_WAL_ENABLED, String(loaded.config.memory.wal_enabled));
  assert.equal(
    process.env.QINGLING_MEMORY_PROJECTION_INTERVAL_MS,
    String(loaded.config.memory.projection_interval_ms)
  );
  assert.equal(process.env.QINGLING_MCP_SERVERS, JSON.stringify(loaded.config.mcp.servers));
  assert.equal(process.env.QINGLING_METRICS_ENABLED, String(loaded.config.metrics.enabled));
  assert.equal(process.env.QINGLING_CHANNEL_DEFAULT, loaded.config.channels.default);
  assert.equal(process.env.QINGLING_GUARD_RATE_LIMIT_ENABLED, "true");
  assert.equal(process.env.QINGLING_GUARD_RATE_LIMIT_MAX_PER_MINUTE, "17");
  assert.equal(process.env.QINGLING_GUARD_CONTENT_FILTER_ENABLED, "true");
  assert.equal(process.env.QINGLING_GUARD_CONTENT_FILTER_PII, "true");
  assert.equal(process.env.QINGLING_GUARD_CONTENT_FILTER_INJECTION, "false");
  assert.equal(process.env.QINGLING_GUARD_CONTENT_FILTER_CUSTOM, JSON.stringify(["SECRET_CONFIG_PATTERN"]));
  assert.equal(process.env.QINGLING_GUARD_PERMISSIONS_RULES, JSON.stringify([{ tool_pattern: "bash", decision: "ask" }]));
});
