import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

import { AgentLoop } from "../../dist/agent-loop.js";
import {
  activePresetIds,
  resolveActiveLlm,
  resolveProviderApiKey,
} from "../../dist/providers/resolve-llm.js";
import { listRemoteModels } from "../../dist/providers/remote-models.js";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function startFakeServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

test("provider keys stay on their own provider", () => {
  const env = {
    QLING_LLM_API_KEY: "sk-startup-deepseek",
    QLING_LLM_STARTUP_PROVIDER: "deepseek",
    DEEPSEEK_API_KEY: "sk-deepseek-specific",
    OPENAI_API_KEY: "sk-openai-specific",
    MOONSHOT_API_KEY: "sk-moon-specific",
  };
  assert.equal(
    resolveProviderApiKey("deepseek", env, { startupProvider: "deepseek" }).apiKey,
    "sk-startup-deepseek"
  );
  const moon = resolveProviderApiKey("moonshot", env, { startupProvider: "deepseek" });
  assert.equal(moon.apiKey, "sk-moon-specific");
  assert.equal(moon.envVar, "MOONSHOT_API_KEY");
  const openai = resolveProviderApiKey("openai", env, { startupProvider: "deepseek" });
  assert.equal(openai.apiKey, "sk-openai-specific");
  assert.notEqual(openai.apiKey, "sk-startup-deepseek");
  assert.notEqual(openai.apiKey, "sk-deepseek-specific");
});

test("cross-provider switch without that provider key is refused", () => {
  const refused = resolveProviderApiKey("kimi", { QLING_LLM_API_KEY: "sk-deepseek" }, {
    startupProvider: "deepseek",
  });
  assert.equal(refused.refused, true);
  assert.equal(refused.apiKey, "");
  assert.match(refused.message, /MOONSHOT_API_KEY/);
  assert.match(refused.message, /\/model use moonshot 后 \/login/);
  assert.doesNotMatch(refused.message, /sk-deepseek/);
});

test("same provider reuses the session key and does not borrow another provider", () => {
  const same = resolveProviderApiKey("deepseek", { OPENAI_API_KEY: "sk-openai" }, {
    startupProvider: "deepseek",
    sameProvider: true,
    sessionApiKey: "sk-session-deepseek",
  });
  assert.equal(same.apiKey, "sk-session-deepseek");
  assert.equal(same.source, "session");
  assert.equal(same.refused, false);
});

test("preset active highlight matches provider endpoint and model together", () => {
  const mimo = activePresetIds({
    provider: "mimo",
    endpoint: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.6-pro",
  });
  assert.deepEqual(mimo, ["mimo"]);
  const tokenPlan = activePresetIds({
    provider: "mimo",
    endpoint: "https://token-plan-cn.xiaomimimo.com/v1",
    model: "mimo-v2.6-pro",
  });
  assert.deepEqual(tokenPlan, ["mimo-token-plan"]);
  assert.deepEqual(
    activePresetIds({
      provider: "deepseek",
      endpoint: "https://api.deepseek.com",
      model: "my-custom-deepseek",
    }),
    []
  );
});

test("src no longer scatters DEEPSEEK_API_KEY ?? fallbacks", () => {
  const hits = walk(join(repoRoot, "src")).filter((file) => {
    if (file.endsWith(`${join("providers", "resolve-llm.ts")}`)) return false;
    return readFileSync(file, "utf8").includes("DEEPSEEK_API_KEY ??");
  });
  assert.deepEqual(hits, []);
});

test("applyLlmSession does not send the previous provider key to the new host", async () => {
  const auths = [];
  const fake = await startFakeServer((req, res) => {
    auths.push(req.headers.authorization || "");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
  });
  const dir = await mkdtemp(join(tmpdir(), "qling-key-switch-"));
  const previousStartup = process.env.QLING_LLM_STARTUP_PROVIDER;
  delete process.env.QLING_LLM_STARTUP_PROVIDER;
  const agent = new AgentLoop({
    apiKey: "sk-deepseek-test",
    provider: "deepseek",
    endpoint: fake.base,
    model: "deepseek-chat",
    maxIterations: 1,
    runtime: {
      workspaceDir: dir,
      fileCacheDir: join(dir, "cache"),
      fileStateDir: dir,
      maxSteps: 1,
      parseRetries: 0,
      toolRepeatLimit: 1,
      timeoutMs: 5000,
    },
  });
  try {
    agent.applyLlmSession({
      provider: "moonshot",
      endpoint: fake.base,
      model: "kimi-k3",
    });
    await agent.llmClient.chatCompletions({
      model: "kimi-k3",
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });
    assert.equal(auths.length, 1);
    assert.notEqual(auths[0], "Bearer sk-deepseek-test");
    assert.doesNotMatch(auths[0], /sk-deepseek-test/);
    assert.equal(agent.compactor.maxTokens, 850000);
    const active = resolveActiveLlm(process.env);
    assert.equal(active.provider, "moonshot");
    assert.notEqual(active.apiKey, "sk-deepseek-test");
  } finally {
    await agent.shutdown();
    await fake.close();
    await rm(dir, { recursive: true, force: true });
    if (previousStartup === undefined) delete process.env.QLING_LLM_STARTUP_PROVIDER;
    else process.env.QLING_LLM_STARTUP_PROVIDER = previousStartup;
    delete process.env.QLING_LLM_SESSION_PROVIDER;
    delete process.env.QLING_LLM_SESSION_ENDPOINT;
    delete process.env.QLING_LLM_SESSION_MODEL;
    delete process.env.QLING_LLM_SESSION_API_KEY;
  }
});

test("GET /models falls back without echoing the key", async () => {
  const fake = await startFakeServer((_req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "nope" } }));
  });
  try {
    const remote = await listRemoteModels({
      endpoint: fake.base,
      apiKey: "sk-should-not-appear",
      timeoutMs: 1000,
    });
    assert.equal(remote.ok, false);
    assert.match(remote.warning, /预设/);
    assert.doesNotMatch(remote.warning, /sk-should-not-appear/);
    assert.deepEqual(remote.models, []);
  } finally {
    await fake.close();
  }
});
