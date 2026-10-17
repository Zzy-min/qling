import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCliArgs, buildHelpText } from "../../dist/cli/startup-contract.js";
import { formatFocusedHelp } from "../../dist/help-topics.js";
import { listProviderModelEntries, providerModelNames } from "../../dist/providers/presets.js";
import { runModelsCli } from "../../dist/providers/remote-models.js";

const readmePath = join(dirname(fileURLToPath(import.meta.url)), "../../README.md");

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

async function captureConsole(fn) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.map(String).join(" "));
  console.error = (...args) => errors.push(args.map(String).join(" "));
  try {
    const code = await fn();
    return { code, logs, errors };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function llm(partial) {
  return {
    provider: "deepseek",
    model: "deepseek-chat",
    endpoint: "https://api.deepseek.com",
    api_key: "sk-current",
    request_timeout_ms: 1000,
    ...partial,
  };
}

test("provider catalogs keep known siblings and drop other providers", () => {
  assert.deepEqual(providerModelNames("deepseek", "deepseek-chat"), [
    "deepseek-flash",
    "deepseek-v4-pro",
    "deepseek-v4-flash",
    "deepseek-chat",
  ]);
  assert.deepEqual(providerModelNames("moonshot", "moonshot-v1-8k"), [
    "kimi-k3",
    "kimi-k2.7-code",
    "kimi-k2.6",
    "moonshot-v1-8k",
  ]);
  assert.deepEqual(providerModelNames("openai", "gpt-4o"), [
    "gpt-6-astra",
    "gpt-6.1-sol",
    "gpt-4o",
    "gpt-4o-mini",
  ]);
  assert.deepEqual(providerModelNames("acme", "custom-model"), ["custom-model"]);
  const mimo = listProviderModelEntries("mimo", "MiMo-V2.5-Pro");
  assert.deepEqual(
    mimo.filter((entry) => entry.presetId).map((entry) => entry.presetId),
    ["mimo", "mimo-token-plan"]
  );
  assert.ok(mimo.some((entry) => entry.model === "mimo-v2.6-flash"));
  assert.ok(mimo.some((entry) => entry.model === "MiMo-V2.5-Pro" && entry.source === "current"));
});

test("qling models defaults to the current provider", async () => {
  const seen = [];
  const fake = await startFakeServer((req, res) => {
    seen.push({ host: req.headers.host, authorization: req.headers.authorization || "" });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "deepseek-remote" }, { id: "deepseek-remote" }] }));
  });
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-openai-other";
  try {
    const { code, logs, errors } = await captureConsole(() => runModelsCli([], {
      llm: llm({ endpoint: fake.base, api_key: "sk-deepseek-fake" }),
    }, process.env));
    const text = [...logs, ...errors].join("\n");
    assert.equal(code, 0);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].host, new URL(fake.base).host);
    assert.equal(seen[0].authorization, "Bearer sk-deepseek-fake");
    assert.match(text, /scope=provider/);
    assert.match(text, /source=remote/);
    assert.match(text, /deepseek-remote/);
    assert.equal(logs.filter((line) => line === "deepseek-remote").length, 1);
    assert.doesNotMatch(text, /llama3|gpt-4o|sk-deepseek-fake|sk-openai-other/);
  } finally {
    await fake.close();
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("qling models falls back to the current provider when remote is empty or 500", async () => {
  const empty = await startFakeServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [] }));
  });
  try {
    const { logs, errors } = await captureConsole(() => runModelsCli([], {
      llm: llm({ endpoint: empty.base, api_key: "sk-empty-cli" }),
    }));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /远端未返回模型/);
    const text = logs.join("\n");
    assert.match(text, /scope=provider/);
    assert.match(text, /deepseek-chat/);
    assert.match(text, /deepseek-flash/);
    assert.match(text, /deepseek-v4-pro/);
    assert.doesNotMatch([...logs, ...errors].join("\n"), /llama3|gpt-4o|sk-empty-cli/);
  } finally {
    await empty.close();
  }

  const failed = await startFakeServer((_req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end("{}");
  });
  try {
    const seen = [];
    const recording = await startFakeServer((req, res) => {
      seen.push(req.headers.host);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "other-host-model" }] }));
    });
    try {
      const { logs, errors } = await captureConsole(() => runModelsCli([], {
        llm: llm({ endpoint: failed.base, api_key: "sk-fail-cli" }),
      }));
      assert.equal(seen.length, 0);
      assert.equal(errors.length, 1);
      assert.match(errors[0], /HTTP 500/);
      assert.match(logs.join("\n"), /deepseek-chat/);
      assert.doesNotMatch([...logs, ...errors].join("\n"), /other-host-model|llama3|sk-fail-cli/);
      await recording.close();
    } catch (error) {
      await recording.close();
      throw error;
    }
  } finally {
    await failed.close();
  }
});

test("qling models --all lists every preset and does not call other hosts", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({
      url: String(url),
      authorization: init?.headers?.Authorization || init?.headers?.authorization || "",
    });
    throw new Error("remote should not be called");
  };
  const previousMoon = process.env.MOONSHOT_API_KEY;
  const previousOpen = process.env.OPENAI_API_KEY;
  process.env.MOONSHOT_API_KEY = "sk-moon-all";
  process.env.OPENAI_API_KEY = "sk-openai-all";
  try {
    const { code, logs, errors } = await captureConsole(() => runModelsCli(["--all"], {
      llm: llm({ api_key: "sk-current-all" }),
    }, process.env, fetchImpl));
    const text = [...logs, ...errors].join("\n");
    assert.equal(code, 0);
    assert.equal(calls.length, 0);
    assert.match(text, /scope=all/);
    assert.match(text, /source=preset/);
    assert.match(text, /deepseek-flash/);
    assert.match(text, /llama3/);
    assert.match(text, /gpt-6-astra/);
    assert.match(text, /kimi-k3/);
    assert.match(text, /qwen3\.7-plus/);
    assert.doesNotMatch(text, /deepseek-chat/);
    assert.doesNotMatch(text, /deepseek-reasoner/);
    assert.doesNotMatch(text, /sk-moon-all|sk-openai-all|sk-current-all/);
  } finally {
    if (previousMoon === undefined) delete process.env.MOONSHOT_API_KEY;
    else process.env.MOONSHOT_API_KEY = previousMoon;
    if (previousOpen === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpen;
  }
});

test("qling models unknown provider prints the current model and one hint", async () => {
  const calls = [];
  const fetchImpl = async () => {
    calls.push("called");
    throw new Error("no");
  };
  const local = await captureConsole(() => runModelsCli(["--local"], {
    llm: llm({
      provider: "acme",
      model: "custom-x",
      endpoint: "http://127.0.0.1:0/v1",
      api_key: "sk-acme",
    }),
  }, process.env, fetchImpl));
  assert.equal(calls.length, 0);
  assert.equal(local.errors.length, 1);
  assert.match(local.errors[0], /未知服务商/);
  assert.match(local.errors[0], /\/model use <preset>/);
  assert.match(local.logs.join("\n"), /custom-x/);
  assert.doesNotMatch([...local.logs, ...local.errors].join("\n"), /llama3|deepseek-chat|sk-acme/);

  const failed = await startFakeServer((_req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end("no");
  });
  try {
    const remote = await captureConsole(() => runModelsCli([], {
      llm: llm({
        provider: "acme",
        model: "custom-x",
        endpoint: failed.base,
        api_key: "sk-acme",
      }),
    }));
    assert.equal(remote.errors.length, 1);
    assert.match(remote.errors[0], /未知服务商/);
    assert.match(remote.errors[0], /HTTP 500/);
    assert.match(remote.errors[0], /\/model use <preset>/);
    assert.match(remote.logs.join("\n"), /custom-x/);
    assert.doesNotMatch([...remote.logs, ...remote.errors].join("\n"), /sk-acme|llama3|deepseek-chat/);
  } finally {
    await failed.close();
  }
});

test("help text mentions the provider filter and models --all", () => {
  const slash = formatFocusedHelp("model", { surface: "slash" }).join("\n");
  const cli = formatFocusedHelp("model", { surface: "cli", binName: "qling" }).join("\n");
  const help = buildHelpText("qling");
  const readme = readFileSync(readmePath, "utf8");
  assert.match(slash, /当前服务商/);
  assert.match(cli, /models --all/);
  assert.match(cli, /当前服务商/);
  assert.match(help, /models \[--all\]/);
  assert.match(help, /不请求其他服务商/);
  assert.match(readme, /当前服务商/);
  assert.match(readme, /qling models --all/);
  const parsed = parseCliArgs(["models", "--all"]);
  assert.equal(parsed.kind, "ok");
  assert.equal(parsed.mode, "models");
  assert.deepEqual(parsed.subArgs, ["--all"]);
});
