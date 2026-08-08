import test from "node:test";
import assert from "node:assert/strict";

import { buildSafeEnv, isProtectedToolEnvKey } from "../../dist/tools/bash.js";

test("bash subprocesses never inherit provider or integration credentials", () => {
  const previous = {
    QLING_LLM_API_KEY: process.env.QLING_LLM_API_KEY,
    QLING_MCP_SERVERS: process.env.QLING_MCP_SERVERS,
    QLING_WORKSPACE_DIR: process.env.QLING_WORKSPACE_DIR,
  };
  try {
    process.env.QLING_LLM_API_KEY = "provider-secret";
    process.env.QLING_MCP_SERVERS = "mcp-auth-secret";
    process.env.QLING_WORKSPACE_DIR = "C:\\safe-workspace";
    const env = buildSafeEnv(
      ["QLING_LLM_API_KEY", "DEEPSEEK_API_KEY"],
      { OPENAI_API_KEY: "injected-secret", SAFE_FLAG: "yes" }
    );
    assert.equal(env.QLING_LLM_API_KEY, undefined);
    assert.equal(env.QLING_MCP_SERVERS, undefined);
    assert.equal(env.DEEPSEEK_API_KEY, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.QLING_WORKSPACE_DIR, "C:\\safe-workspace");
    assert.equal(env.SAFE_FLAG, "yes");
    assert.equal(isProtectedToolEnvKey("QLING_TELEGRAM_BOT_TOKEN"), true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
