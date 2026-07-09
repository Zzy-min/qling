import test from "node:test";
import assert from "node:assert/strict";

import { modelCommand } from "../../dist/commands/claude-style.js";

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
  assert.match(text, /Provider\s*:\s*deepseek/);
  assert.match(text, /Endpoint\s*:/);
  assert.match(text, /Model\s*:\s*deepseek-chat/);
  assert.match(text, /\/model list/);
  assert.match(text, /\/model use/);
});

test("/model list prints presets", async () => {
  const { context, lines } = createContext();
  await modelCommand.execute(["list"], context);
  const text = lines.join("\n");
  assert.match(text, /ollama/);
  assert.match(text, /deepseek/);
  assert.match(text, /openai/);
});

test("/model use ollama switches full LLM session", async () => {
  const { context, lines, state } = createContext();
  await modelCommand.execute(["use", "ollama"], context);
  assert.equal(state.provider, "ollama");
  assert.equal(state.endpoint, "http://localhost:11434/v1");
  assert.equal(state.model, "llama3");
  const text = lines.join("\n");
  assert.match(text, /已应用预设/);
  assert.match(text, /ollama/);
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
