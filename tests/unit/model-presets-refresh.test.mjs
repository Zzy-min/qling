import test from "node:test";
import assert from "node:assert/strict";

import { buildDefaultConfig } from "../../dist/config.js";
import { modelCommand } from "../../dist/commands/claude-style.js";
import {
  getProviderPreset,
  knownModelsForProvider,
  lookupModelWindow,
  lookupRetiredModel,
  providerModelNames,
} from "../../dist/providers/presets.js";

const EXPECTED_PRESETS = {
  deepseek: { model: "deepseek-flash", contextWindow: 1000000, maxOutputTokens: 393216 },
  dashscope: { model: "qwen3.7-plus", contextWindow: 1000000, maxOutputTokens: 131072 },
  zhipu: { model: "glm-5.3", contextWindow: 1000000, maxOutputTokens: 131072 },
  moonshot: { model: "kimi-k3", contextWindow: 1000000, maxOutputTokens: undefined },
  minimax: { model: "MiniMax-M3", contextWindow: 1000000, maxOutputTokens: undefined },
  mimo: { model: "mimo-v2.6-pro", contextWindow: 1000000, maxOutputTokens: 131072 },
  "mimo-token-plan": { model: "mimo-v2.6-pro", contextWindow: 1000000, maxOutputTokens: 131072 },
  siliconflow: {
    model: "deepseek-ai/DeepSeek-V4.1-Flash",
    contextWindow: undefined,
    maxOutputTokens: undefined,
  },
  openai: { model: "gpt-6-astra", contextWindow: 1050000, maxOutputTokens: 131072 },
  ollama: { model: "llama3", contextWindow: 8192, maxOutputTokens: undefined },
  local: { model: "llama3", contextWindow: 8192, maxOutputTokens: undefined },
};

test("preset default models match the 2026-10-16 table", () => {
  for (const [id, expected] of Object.entries(EXPECTED_PRESETS)) {
    const preset = getProviderPreset(id);
    assert.equal(preset?.model, expected.model, id);
    assert.equal(preset?.contextWindow, expected.contextWindow, id);
    assert.equal(preset?.maxOutputTokens, expected.maxOutputTokens, id);
  }
  assert.equal(getProviderPreset("minimax")?.endpoint, "https://api.minimaxi.com/v1");
  assert.equal(getProviderPreset("ollama")?.model, getProviderPreset("local")?.model);
  assert.equal(buildDefaultConfig().llm.model, "deepseek-flash");
  assert.equal(buildDefaultConfig().vision.model, "gpt-4o");
});

test("known windows match the 2026-10-16 table", () => {
  const windows = {
    "deepseek-flash": { contextWindow: 1000000, maxOutputTokens: 393216 },
    "deepseek-v4-pro": { contextWindow: 1000000, maxOutputTokens: 393216 },
    "deepseek-v4-flash": { contextWindow: 1000000, maxOutputTokens: 393216 },
    "qwen3.7-plus": { contextWindow: 1000000, maxOutputTokens: 131072 },
    "qwen-plus": { contextWindow: 128000 },
    "glm-5.3": { contextWindow: 1000000, maxOutputTokens: 131072 },
    "glm-5.3-flash": { contextWindow: 1000000, maxOutputTokens: 131072 },
    "glm-5.2": { contextWindow: 1000000, maxOutputTokens: 131072 },
    "glm-4": { contextWindow: 128000 },
    "kimi-k3": { contextWindow: 1000000 },
    "kimi-k2.7-code": { contextWindow: 256000 },
    "kimi-k2.6": { contextWindow: 256000 },
    "MiniMax-M3": { contextWindow: 1000000 },
    "MiniMax-M2.7": { contextWindow: 204800 },
    "mimo-v2.6-pro": { contextWindow: 1000000, maxOutputTokens: 131072 },
    "mimo-v2.6-flash": { contextWindow: 1000000, maxOutputTokens: 131072 },
    "gpt-6-astra": { contextWindow: 1050000, maxOutputTokens: 131072 },
    "gpt-6.1-sol": { contextWindow: 1050000, maxOutputTokens: 131072 },
    "gpt-4o": { contextWindow: 128000, maxOutputTokens: 16384 },
    "gpt-4o-mini": { contextWindow: 128000, maxOutputTokens: 16384 },
    "Qwen/Qwen2.5-7B-Instruct": { contextWindow: 32768 },
    llama3: { contextWindow: 8192 },
  };
  for (const [model, expected] of Object.entries(windows)) {
    assert.deepEqual(lookupModelWindow(model), expected, model);
  }
  assert.equal(lookupModelWindow("deepseek-ai/DeepSeek-V4.1-Flash"), null);
});

test("deepseek catalog includes flash and v4-pro and omits retired ids", () => {
  const names = providerModelNames("deepseek");
  assert.ok(names.includes("deepseek-flash"));
  assert.ok(names.includes("deepseek-v4-pro"));
  assert.ok(names.includes("deepseek-v4-flash"));
  assert.equal(names.includes("deepseek-chat"), false);
  assert.equal(names.includes("deepseek-reasoner"), false);
  assert.deepEqual(knownModelsForProvider("zhipu").filter((model) => model.startsWith("glm-5")), [
    "glm-5.3",
    "glm-5.3-flash",
    "glm-5.2",
  ]);
  assert.ok(knownModelsForProvider("moonshot").includes("kimi-k2.7-code"));
  assert.ok(knownModelsForProvider("moonshot").includes("kimi-k2.6"));
  assert.ok(knownModelsForProvider("mimo").includes("mimo-v2.6-flash"));
  assert.ok(knownModelsForProvider("openai").includes("gpt-6.1-sol"));
  assert.ok(knownModelsForProvider("minimax").includes("MiniMax-M2.7"));
  assert.equal(knownModelsForProvider("deepseek").includes("kimi-k3"), false);
  assert.equal(knownModelsForProvider("deepseek").includes("gpt-6.1-sol"), false);
  assert.equal(knownModelsForProvider("openai").includes("deepseek-flash"), false);
});

test("retired model windows are null and are not rewritten", () => {
  const retired = [
    "deepseek-chat",
    "deepseek-reasoner",
    "moonshot-v1-8k",
    "moonshot-v1-32k",
    "moonshot-v1-128k",
    "MiMo-V2.5-Pro",
  ];
  for (const model of retired) {
    assert.equal(lookupModelWindow(model), null, model);
    assert.equal(lookupModelWindow(model.toLowerCase()), null, model);
    assert.ok(lookupRetiredModel(model), model);
  }
  assert.equal(lookupRetiredModel("deepseek-chat"), "deepseek-flash");
  assert.equal(lookupRetiredModel("deepseek-reasoner"), "deepseek-flash");
  assert.equal(lookupRetiredModel("MOONSHOT-V1-128K"), "kimi-k3");
  assert.equal(lookupRetiredModel("mimo-v2.5-pro"), "mimo-v2.6-pro");
  assert.equal(lookupRetiredModel("deepseek-flash"), null);
  assert.equal(lookupRetiredModel("gpt-4o"), null);
  assert.equal(providerModelNames("deepseek", "deepseek-chat").at(-1), "deepseek-chat");
});

test("/model status names a retired model and suggests the replacement", async () => {
  const lines = [];
  const state = { model: "deepseek-chat" };
  await modelCommand.execute(["status"], {
    writeLine: (line) => lines.push(String(line)),
    writeError: () => {},
    agentLoop: {
      getModel: () => state.model,
      getProvider: () => "deepseek",
      getEndpoint: () => "https://api.deepseek.com",
    },
  });
  const text = lines.join("\n");
  assert.match(text, /Model\s*:\s*deepseek-chat/);
  assert.match(text, /该模型已下线，建议换成 deepseek-flash/);
  assert.equal(state.model, "deepseek-chat");
});
