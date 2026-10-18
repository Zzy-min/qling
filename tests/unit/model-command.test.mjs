import test from "node:test";
import assert from "node:assert/strict";

import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { modelCommand } from "../../dist/commands/claude-style.js";
import { AgentLoop } from "../../dist/agent-loop.js";
import { activePresetIds } from "../../dist/providers/resolve-llm.js";

function createContext(loopOverrides = {}) {
  const lines = [];
  const errors = [];
  const state = {
    model: "deepseek-chat",
    provider: "deepseek",
    endpoint: "https://api.deepseek.com",
    apiKey: "sk-test",
  };
  return {
    lines,
    errors,
    state,
    context: {
      writeLine: (s) => lines.push(String(s)),
      writeError: (s) => errors.push(String(s)),
      onModelChanged: async () => {},
      agentLoop: {
        getModel: () => state.model,
        getProvider: () => state.provider,
        getEndpoint: () => state.endpoint,
        setModel: (m) => {
          state.model = m;
        },
        applyLlmSession: (patch) => {
          if (patch.model) state.model = patch.model;
          if (patch.provider) state.provider = patch.provider;
          if (patch.endpoint) state.endpoint = patch.endpoint;
          if (typeof patch.apiKey === "string") state.apiKey = patch.apiKey || "local";
          return {
            provider: state.provider,
            endpoint: state.endpoint,
            model: state.model,
          };
        },
        ...loopOverrides,
      },
    },
  };
}

test("/model with no args shows provider endpoint model", async () => {
  const { context, lines } = createContext();
  await modelCommand.execute([], context);
  const text = lines.join("\n");
  assert.match(text, /当前\s*:.*deepseek.*deepseek-chat/);
  assert.match(text, /Endpoint\s*:/);
  assert.match(text, /\/model use/);
  assert.match(text, /\/model use/);
});

test("/model list prints presets", async () => {
  const { context, lines } = createContext();
  await modelCommand.execute(["list"], context);
  const text = lines.join("\n");
  assert.match(text, /deepseek/);
  assert.match(text, /deepseek-flash/);
  assert.match(text, /deepseek-v4-pro/);
  assert.match(text, /deepseek-chat/);
  assert.doesNotMatch(text, /ollama/);
  assert.doesNotMatch(text, /openai/);
  assert.doesNotMatch(text, /moonshot/);
});

test("/model use ollama switches full LLM session", async () => {
  const { context, lines, state } = createContext();
  await modelCommand.execute(["use", "ollama"], context);
  assert.equal(state.provider, "ollama");
  assert.equal(state.endpoint, "http://localhost:11434/v1");
  assert.equal(state.model, "llama3");
  const text = lines.join("\n");
  assert.match(text, /ollama.*本地 Ollama.*llama3/);
});

test("/model <name> only switches model", async () => {
  const { context, state } = createContext();
  await modelCommand.execute(["qwen-plus"], context);
  assert.equal(state.model, "qwen-plus");
  assert.equal(state.provider, "deepseek");
  assert.equal(state.endpoint, "https://api.deepseek.com");
});

test("/model use unknown preset errors", async () => {
  const { context, errors } = createContext();
  await modelCommand.execute(["use", "no-such-preset"], context);
  assert.ok(errors.some((e) => /未找到预设/.test(e)));
});

test("/model use kimi without MOONSHOT_API_KEY is refused and does not apply", async () => {
  const previous = process.env.MOONSHOT_API_KEY;
  delete process.env.MOONSHOT_API_KEY;
  const calls = [];
  const { context, errors, state } = createContext({
    applyLlmSession: (patch) => {
      calls.push(patch);
    },
    getStartupProvider: () => "deepseek",
  });
  try {
    await modelCommand.execute(["use", "kimi"], context);
    assert.equal(calls.length, 0);
    assert.equal(state.provider, "deepseek");
    assert.equal(state.apiKey, "sk-test");
    assert.ok(errors.some((line) => /MOONSHOT_API_KEY/.test(line)));
    assert.ok(errors.every((line) => !/sk-test/.test(line)));
  } finally {
    if (previous === undefined) delete process.env.MOONSHOT_API_KEY;
    else process.env.MOONSHOT_API_KEY = previous;
  }
});

test("/model use kimi with MOONSHOT_API_KEY reconfigures that key only", async () => {
  const previous = process.env.MOONSHOT_API_KEY;
  process.env.MOONSHOT_API_KEY = "sk-moon-test";
  const calls = [];
  const { context, state } = createContext({
    applyLlmSession: (patch) => {
      calls.push(patch);
      if (patch.provider) state.provider = patch.provider;
      if (patch.endpoint) state.endpoint = patch.endpoint;
      if (patch.model) state.model = patch.model;
      if (typeof patch.apiKey === "string") state.apiKey = patch.apiKey;
    },
    getStartupProvider: () => "deepseek",
  });
  try {
    await modelCommand.execute(["use", "kimi"], context);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].apiKey, "sk-moon-test");
    assert.notEqual(calls[0].apiKey, "sk-test");
    assert.equal(state.provider, "moonshot");
    assert.equal(state.model, "kimi-k3");
  } finally {
    if (previous === undefined) delete process.env.MOONSHOT_API_KEY;
    else process.env.MOONSHOT_API_KEY = previous;
  }
});

test('/model rejects names that contain spaces', async () => {
  const { context, errors, state } = createContext();
  await modelCommand.execute(["foo", "bar"], context);
  assert.equal(state.model, "deepseek-chat");
  assert.ok(errors.some((line) => /空格/.test(line)));
});

test("preset active set never highlights more than one provider row", () => {
  const ids = activePresetIds({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com",
    model: "deepseek-flash",
  });
  assert.equal(ids.length, 1);
  assert.deepEqual(ids, ["deepseek"]);
});

function startFakeServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

test("/model list --remote uses the mock server and never prints the key", async () => {
  const seen = [];
  const fake = await startFakeServer((req, res) => {
    seen.push(req.headers.authorization || "");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "remote-model-a" }] }));
  });
  try {
    const { context, lines, errors } = createContext({
      getEndpoint: () => fake.base,
      getApiKey: () => "sk-remote-test",
    });
    await modelCommand.execute(["list", "--remote"], context);
    const text = [...lines, ...errors].join("\n");
    assert.match(text, /remote-model-a/);
    assert.equal(seen[0], "Bearer sk-remote-test");
    assert.doesNotMatch(text, /sk-remote-test/);
  } finally {
    await fake.close();
  }
});

test("refused /model use kimi does not send the deepseek key anywhere", async () => {
  const requests = [];
  const fake = await startFakeServer((req, res) => {
    requests.push(req.headers.authorization || "");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
  });
  const dir = await mkdtemp(join(tmpdir(), "qling-model-refuse-"));
  const previousMoon = process.env.MOONSHOT_API_KEY;
  const previousStartup = process.env.QLING_LLM_STARTUP_PROVIDER;
  delete process.env.MOONSHOT_API_KEY;
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
  const lines = [];
  const errors = [];
  try {
    await modelCommand.execute(["use", "kimi"], {
      writeLine: (line) => lines.push(String(line)),
      writeError: (line) => errors.push(String(line)),
      agentLoop: agent,
    });
    assert.equal(agent.getProvider(), "deepseek");
    assert.equal(requests.length, 0);
    await agent.llmClient.chatCompletions({
      model: "deepseek-chat",
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0], "Bearer sk-deepseek-test");
    assert.ok(errors.some((line) => /MOONSHOT_API_KEY/.test(line)));
    assert.doesNotMatch([...lines, ...errors].join("\n"), /sk-deepseek-test/);
  } finally {
    await agent.shutdown();
    await fake.close();
    await rm(dir, { recursive: true, force: true });
    if (previousMoon === undefined) delete process.env.MOONSHOT_API_KEY;
    else process.env.MOONSHOT_API_KEY = previousMoon;
    if (previousStartup === undefined) delete process.env.QLING_LLM_STARTUP_PROVIDER;
    else process.env.QLING_LLM_STARTUP_PROVIDER = previousStartup;
    delete process.env.QLING_LLM_SESSION_PROVIDER;
    delete process.env.QLING_LLM_SESSION_ENDPOINT;
    delete process.env.QLING_LLM_SESSION_MODEL;
    delete process.env.QLING_LLM_SESSION_API_KEY;
  }
});

function activeItems(spec) {
  return spec.items.filter((item) => item.active);
}

test("/model picker and list stay on the current provider, then moonshot after use", async () => {
  const previous = process.env.MOONSHOT_API_KEY;
  process.env.MOONSHOT_API_KEY = "sk-moon-filter";
  const specs = [];
  const { context, lines, errors, state } = createContext({
    getStartupProvider: () => "deepseek",
  });
  context.openOptionPicker = (spec) => {
    specs.push(spec);
  };
  try {
    await modelCommand.execute([], context);
    assert.equal(specs.length, 1);
    assert.equal(activeItems(specs[0]).length, 1);
    const deepseekBlob = specs[0].items.map((item) => `${item.id} ${item.label} ${item.description}`).join("\n");
    assert.match(deepseekBlob, /deepseek/);
    assert.match(deepseekBlob, /model:deepseek-v4-pro/);
    assert.doesNotMatch(deepseekBlob, /ollama|openai|moonshot|qwen|glm/i);
    const pro = specs[0].items.find((item) => item.id === "model:deepseek-v4-pro");
    await specs[0].onPick(pro);
    assert.equal(state.provider, "deepseek");
    assert.equal(state.endpoint, "https://api.deepseek.com");
    assert.equal(state.model, "deepseek-v4-pro");

    delete context.openOptionPicker;
    lines.length = 0;
    await modelCommand.execute(["list"], context);
    const listed = lines.join("\n");
    assert.match(listed, /deepseek-flash/);
    assert.match(listed, /deepseek-v4-pro/);
    assert.doesNotMatch(listed, /deepseek-chat/);
    assert.doesNotMatch(listed, /ollama|openai|moonshot/);

    context.openOptionPicker = (spec) => {
      specs.push(spec);
    };
    await modelCommand.execute(["use", "kimi"], context);
    assert.equal(state.provider, "moonshot");
    assert.equal(state.model, "kimi-k3");
    assert.equal(state.apiKey, "sk-moon-filter");
    specs.length = 0;
    lines.length = 0;
    await modelCommand.execute([], context);
    assert.equal(specs.length, 1);
    assert.equal(activeItems(specs[0]).length, 1);
    const moonBlob = specs[0].items.map((item) => `${item.id} ${item.label} ${item.description}`).join("\n");
    assert.match(moonBlob, /kimi-k3/);
    assert.match(moonBlob, /kimi-k2\.7-code/);
    assert.match(moonBlob, /kimi-k2\.6/);
    assert.doesNotMatch(moonBlob, /deepseek|ollama|openai|qwen-plus|glm-4/);

    delete context.openOptionPicker;
    lines.length = 0;
    await modelCommand.execute(["list"], context);
    const moonList = lines.join("\n");
    assert.match(moonList, /kimi-k3/);
    assert.doesNotMatch(moonList, /deepseek|ollama|openai/);
    assert.doesNotMatch([...lines, ...errors].join("\n"), /sk-moon-filter/);
  } finally {
    if (previous === undefined) delete process.env.MOONSHOT_API_KEY;
    else process.env.MOONSHOT_API_KEY = previous;
  }
});

test("/model list --remote requests only the current endpoint and that provider key", async () => {
  const previous = process.env.MOONSHOT_API_KEY;
  process.env.MOONSHOT_API_KEY = "sk-other-provider";
  const seen = [];
  const fake = await startFakeServer((req, res) => {
    seen.push({
      host: req.headers.host,
      authorization: req.headers.authorization || "",
      url: req.url,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "remote-only-model" }] }));
  });
  try {
    const { context, lines, errors } = createContext({
      getEndpoint: () => fake.base,
      getApiKey: () => "sk-current-provider",
    });
    await modelCommand.execute(["list", "--remote"], context);
    const text = [...lines, ...errors].join("\n");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].host, new URL(fake.base).host);
    assert.equal(seen[0].url, "/models");
    assert.equal(seen[0].authorization, "Bearer sk-current-provider");
    assert.notEqual(seen[0].authorization, "Bearer sk-other-provider");
    assert.match(text, /remote-only-model/);
    assert.doesNotMatch(text, /ollama|openai|moonshot|sk-current-provider|sk-other-provider/);
  } finally {
    await fake.close();
    if (previous === undefined) delete process.env.MOONSHOT_API_KEY;
    else process.env.MOONSHOT_API_KEY = previous;
  }
});

test("/model list --remote empty or 500 falls back to the current provider presets", async () => {
  const empty = await startFakeServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [] }));
  });
  try {
    const { context, lines, errors } = createContext({
      getEndpoint: () => empty.base,
      getApiKey: () => "sk-empty-remote",
    });
    await modelCommand.execute(["list", "--remote"], context);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /远端未返回模型/);
    assert.doesNotMatch(errors[0], /sk-empty-remote/);
    const text = lines.join("\n");
    assert.match(text, /deepseek-chat/);
    assert.match(text, /deepseek-flash/);
    assert.match(text, /deepseek-v4-pro/);
    assert.doesNotMatch(text, /ollama|openai|moonshot|sk-empty-remote/);
  } finally {
    await empty.close();
  }

  const failed = await startFakeServer((_req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "nope" } }));
  });
  try {
    const { context, lines, errors } = createContext({
      getEndpoint: () => failed.base,
      getApiKey: () => "sk-fail-remote",
    });
    await modelCommand.execute(["list", "--remote"], context);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /HTTP 500/);
    assert.doesNotMatch(errors.join("\n"), /sk-fail-remote/);
    const text = lines.join("\n");
    assert.match(text, /deepseek-chat/);
    assert.match(text, /deepseek-flash/);
    assert.match(text, /deepseek-v4-pro/);
    assert.doesNotMatch(text, /ollama|openai|sk-fail-remote/);
  } finally {
    await failed.close();
  }
});

test("/model list for an unknown provider shows the current model and a use hint", async () => {
  const { context, lines, errors } = createContext({
    getProvider: () => "not-a-provider",
    getModel: () => "custom-model",
    getEndpoint: () => "http://127.0.0.1:9/v1",
  });
  await modelCommand.execute(["list"], context);
  const text = lines.join("\n");
  assert.match(text, /custom-model/);
  assert.match(text, /未知服务商/);
  assert.match(text, /\/model use <preset>/);
  assert.doesNotMatch(text, /ollama|openai|deepseek-chat|moonshot/);
  assert.equal(errors.length, 0);

  const specs = [];
  context.openOptionPicker = (spec) => {
    specs.push(spec);
  };
  await modelCommand.execute([], context);
  assert.equal(specs.length, 1);
  assert.equal(activeItems(specs[0]).length, 1);
  assert.deepEqual(specs[0].items.map((item) => item.label), ["custom-model"]);

  const failed = await startFakeServer((_req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end("{}");
  });
  try {
    const remote = createContext({
      getProvider: () => "not-a-provider",
      getModel: () => "custom-model",
      getEndpoint: () => failed.base,
      getApiKey: () => "sk-unknown-remote",
    });
    await modelCommand.execute(["list", "--remote"], remote.context);
    assert.equal(remote.errors.length, 1);
    assert.match(remote.errors[0], /未知服务商/);
    assert.match(remote.errors[0], /HTTP 500/);
    assert.match(remote.errors[0], /\/model use <preset>/);
    assert.doesNotMatch(remote.errors[0], /sk-unknown-remote/);
    const remoteText = remote.lines.join("\n");
    assert.match(remoteText, /custom-model/);
    assert.equal(remoteText.match(/未知服务商/g)?.length ?? 0, 0);
    assert.doesNotMatch(remoteText, /ollama|deepseek-chat|sk-unknown-remote/);
  } finally {
    await failed.close();
  }
});
