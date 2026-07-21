import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyConfigToProcessEnv, loadQlingConfig } from "../../dist/config.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "qling-config-test-"));
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
    const configPath = join(dir, "qling.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        llm: { model: "from-file" },
      }),
      "utf-8"
    );

    await withEnv({ QLING_LLM_MODEL: "from-env" }, async () => {
      const loaded = await loadQlingConfig({
        configPath,
        model: "from-cli",
      });
      assert.equal(loaded.config.llm.model, "from-cli");
    });
  });
});

test("memory dream LLM is opt-in by default", async () => {
  const loaded = await loadQlingConfig({});
  assert.equal(loaded.config.memory.dream_llm_enabled, false);
  assert.equal(loaded.config.experimental.streaming_chat, false);
});

test("config supports ${ENV_VAR} template expansion with warnings", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "qling.config.yaml");
    await writeFile(
      configPath,
      "llm:\n  api_key: ${MY_TEST_KEY}\nruntime:\n  workspace_dir: ${MISSING_KEY}\n",
      "utf-8"
    );
    await withEnv({ MY_TEST_KEY: "abc-123", MISSING_KEY: undefined }, async () => {
      const loaded = await loadQlingConfig({ configPath });
      assert.equal(loaded.config.llm.api_key, "abc-123");
      assert.match(loaded.warnings.join("\n"), /Missing env variable/);
    });
  });
});

test("config cli noWorkspace overrides workspace root", async () => {
  const loaded = await loadQlingConfig({ noWorkspace: true });
  assert.equal(loaded.config.runtime.workspace_dir, null);
});

test("config supports legacy runtime env aliases for workspace/cache/state dirs", async () => {
  const workspaceDir = process.cwd();
  const stateDir = join(workspaceDir, ".tmp-state");
  const cacheDir = join(stateDir, "cache-custom");
  await withEnv(
    {
      QLING_WORKSPACE_DIR: workspaceDir,
      QLING_FILE_CACHE_DIR: cacheDir,
      QLING_FILE_STATE_DIR: stateDir,
    },
    async () => {
      const loaded = await loadQlingConfig({});
      assert.equal(loaded.config.runtime.workspace_dir, workspaceDir);
      assert.equal(loaded.config.runtime.file_cache_dir, cacheDir);
      assert.equal(loaded.config.runtime.file_state_dir, stateDir);
    }
  );
});

test("config supports permissions.mode compatibility from config file", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "qling.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        permissions: { mode: "deny" },
      }),
      "utf-8"
    );
    const loaded = await loadQlingConfig({ configPath });
    assert.equal(loaded.config.guard.permissions.default, "deny");
  });
});

test("config supports QLING_PERMISSIONS_MODE env alias", async () => {
  await withEnv(
    {
      QLING_PERMISSIONS_MODE: "ask",
      QLING_GUARD_PERMISSIONS_DEFAULT: undefined,
    },
    async () => {
      const loaded = await loadQlingConfig({});
      assert.equal(loaded.config.guard.permissions.default, "ask");
    }
  );
});

test("config supports QLING_GUARD_CONTENT_FILTER_CUSTOM env alias", async () => {
  await withEnv(
    {
      QLING_GUARD_CONTENT_FILTER_CUSTOM: JSON.stringify(["SECRET_CUSTOM_ALIAS"]),
      QLING_GUARD_CONTENT_FILTER_CUSTOM_PATTERNS: undefined,
    },
    async () => {
      const loaded = await loadQlingConfig({});
      assert.deepEqual(loaded.config.guard.content_filter.custom_patterns, ["SECRET_CUSTOM_ALIAS"]);
    }
  );
});

test("config supports agents.isolation fields from config file", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "qling.config.json");
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
    const loaded = await loadQlingConfig({ configPath });
    assert.equal(loaded.config.agents.isolation.mode, "off");
    assert.equal(loaded.config.agents.isolation.require_git, false);
    assert.equal(loaded.config.agents.isolation.non_git_policy, "off");
  });
});

test("config supports agents isolation env aliases", async () => {
  await withEnv(
    {
      QLING_AGENTS_ISOLATION_MODE: "off",
      QLING_AGENTS_ISOLATION_REQUIRE_GIT: "false",
      QLING_AGENTS_ISOLATION_NON_GIT_POLICY: "deny",
    },
    async () => {
      const loaded = await loadQlingConfig({});
      assert.equal(loaded.config.agents.isolation.mode, "off");
      assert.equal(loaded.config.agents.isolation.require_git, false);
      assert.equal(loaded.config.agents.isolation.non_git_policy, "deny");
    }
  );
});

test("config: explicit missing config path throws", async () => {
  await assert.rejects(() =>
    loadQlingConfig({
      configPath: join(process.cwd(), "definitely-not-exist-config.json"),
    })
  );
});

test("applyConfigToProcessEnv maps memory/mcp/metrics/channels and guard fields", async () => {
  const loaded = await loadQlingConfig({});
  loaded.config.guard.rate_limit.enabled = true;
  loaded.config.guard.rate_limit.max_per_minute = 17;
  loaded.config.guard.content_filter.enabled = true;
  loaded.config.guard.content_filter.pii_detection = true;
  loaded.config.guard.content_filter.injection_detection = false;
  loaded.config.guard.content_filter.custom_patterns = ["SECRET_CONFIG_PATTERN"];
  loaded.config.guard.permissions.rules = [{ tool_pattern: "bash", decision: "ask" }];
  applyConfigToProcessEnv(loaded.config);

  assert.equal(process.env.QLING_MEMORY_WAL_ENABLED, String(loaded.config.memory.wal_enabled));
  assert.equal(process.env.QLING_EXPERIMENTAL_STREAMING_CHAT, "false");
  assert.equal(
    process.env.QLING_MEMORY_PROJECTION_INTERVAL_MS,
    String(loaded.config.memory.projection_interval_ms)
  );
  assert.equal(process.env.QLING_MCP_SERVERS, JSON.stringify(loaded.config.mcp.servers));
  assert.equal(process.env.QLING_METRICS_ENABLED, String(loaded.config.metrics.enabled));
  assert.equal(process.env.QLING_METRICS_OTEL_ENABLED, "false");
  assert.equal(process.env.QLING_METRICS_OTEL_TIMEOUT_MS, "3000");
  assert.equal(process.env.QLING_CHANNEL_DEFAULT, loaded.config.channels.default);
  assert.equal(process.env.QLING_GUARD_RATE_LIMIT_ENABLED, "true");
  assert.equal(process.env.QLING_GUARD_RATE_LIMIT_MAX_PER_MINUTE, "17");
  assert.equal(process.env.QLING_GUARD_CONTENT_FILTER_ENABLED, "true");
  assert.equal(process.env.QLING_GUARD_CONTENT_FILTER_PII, "true");
  assert.equal(process.env.QLING_GUARD_CONTENT_FILTER_INJECTION, "false");
  assert.equal(process.env.QLING_GUARD_CONTENT_FILTER_CUSTOM, JSON.stringify(["SECRET_CONFIG_PATTERN"]));
  assert.equal(process.env.QLING_GUARD_PERMISSIONS_RULES, JSON.stringify([{ tool_pattern: "bash", decision: "ask" }]));
});

test("config loads optional OTEL settings from QLING environment", async () => {
  const loaded = await loadQlingConfig({}, {
    QLING_METRICS_OTEL_ENABLED: "true",
    QLING_METRICS_OTEL_ENDPOINT: "http://127.0.0.1:4318/v1/traces",
    QLING_METRICS_OTEL_TIMEOUT_MS: "4500",
    QLING_METRICS_OTEL_BATCH_DELAY_MS: "400",
  });
  assert.deepEqual(loaded.config.metrics.otel, {
    enabled: true,
    endpoint: "http://127.0.0.1:4318/v1/traces",
    timeout_ms: 4500,
    batch_delay_ms: 400,
  });
});
