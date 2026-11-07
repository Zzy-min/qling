import test from "node:test";
import assert from "node:assert/strict";

import {
  listAllGroupedProviderModelEntries,
  formatAllGroupedProviderModelLines,
} from "../../dist/providers/presets.js";
import { modelCommand } from "../../dist/commands/claude-style.js";

function createContext(options = {}) {
  const lines = [];
  const errors = [];
  const state = {
    provider: options.provider || "openai",
    model: options.model || "codestral-latest",
    endpoint: options.endpoint || "https://api.mistral.ai/v1",
    apiKey: options.apiKey || "sk-current",
  };
  const loop = {
    getProvider: () => state.provider,
    getModel: () => state.model,
    getEndpoint: () => state.endpoint,
    getApiKey: () => state.apiKey,
    getStartupProvider: options.getStartupProvider || (() => state.provider),
    applyLlmSession: (update) => {
      if (update.provider) state.provider = update.provider;
      if (update.model) state.model = update.model;
      if (update.endpoint) state.endpoint = update.endpoint;
      if (update.apiKey !== undefined) state.apiKey = update.apiKey;
    },
    setModel: (m) => { state.model = m; },
    getWorkspaceDir: () => process.cwd(),
  };
  const context = {
    agentLoop: loop,
    writeLine: (text) => lines.push(text),
    writeError: (text) => errors.push(text),
    onModelChanged: async (m) => {},
  };
  return { context, lines, errors, state };
}

test("listAllGroupedProviderModelEntries groups all providers and tags current provider", () => {
  const sections = listAllGroupedProviderModelEntries("deepseek", "deepseek-flash");
  assert.ok(sections.length >= 8, `Expected at least 8 sections, got ${sections.length}`);
  
  const deepseek = sections.find((s) => s.providerId === "deepseek");
  assert.ok(deepseek, "DeepSeek section must exist");
  assert.equal(deepseek.isCurrent, true);
  assert.ok(deepseek.entries.length >= 2);
  assert.ok(deepseek.entries.some((e) => e.model === "deepseek-flash"));
  assert.ok(deepseek.entries.some((e) => e.model === "deepseek-v4-pro"));

  const qwen = sections.find((s) => s.providerId === "dashscope");
  assert.ok(qwen, "DashScope / Qwen section must exist");
  assert.equal(qwen.isCurrent, false);
  assert.ok(qwen.entries.some((e) => e.model === "qwen3.7-plus"));

  const openai = sections.find((s) => s.providerId === "openai");
  assert.ok(openai, "OpenAI section must exist");
  assert.equal(openai.isCurrent, false);
});

test("listAllGroupedProviderModelEntries handles custom unknown provider", () => {
  const sections = listAllGroupedProviderModelEntries("my-custom-provider", "custom-model-99");
  const custom = sections.find((s) => s.providerId === "my-custom-provider");
  assert.ok(custom, "Custom provider section must be created");
  assert.equal(custom.isCurrent, true);
  assert.ok(custom.entries.some((e) => e.model === "custom-model-99"));
});

test("formatAllGroupedProviderModelLines renders provider headers and model lists", () => {
  const lines = formatAllGroupedProviderModelLines("deepseek", "deepseek-flash");
  const blob = lines.join("\n");
  assert.match(blob, /DeepSeek/);
  assert.match(blob, /阿里云百炼/);
  assert.match(blob, /智谱清言/);
  assert.match(blob, /月之暗面/);
  assert.match(blob, /OpenAI/);
});

test("/model opens picker with sections grouped by provider", async () => {
  const specs = [];
  const { context } = createContext({
    provider: "deepseek",
    model: "deepseek-flash",
  });
  context.openOptionPicker = (spec) => {
    specs.push(spec);
  };

  await modelCommand.execute([], context);
  assert.equal(specs.length, 1);
  const spec = specs[0];
  assert.equal(spec.title, "模型切换 · 按服务商浏览");

  const sectionItems = spec.items.filter((item) => item.section);
  assert.ok(sectionItems.length >= 8, `Expected at least 8 sections, got ${sectionItems.length}`);
  for (const sec of sectionItems) {
    assert.equal(sec.collapsible, true);
    assert.ok(sec.sectionCount > 0);
  }

  // Current active model should be deepseek-flash under deepseek
  const activeItem = spec.items.find((item) => item.active);
  assert.ok(activeItem, "An active item must be marked");
  assert.equal(activeItem.id, "deepseek");
  assert.match(activeItem.label, /deepseek/i);

  // Other providers' models are also included
  assert.ok(spec.items.some((item) => item.id === "dashscope" || item.label.includes("qwen")));
  assert.ok(spec.items.some((item) => item.id === "zhipu" || item.label.includes("glm")));
  assert.ok(spec.items.some((item) => item.id === "moonshot" || item.label.includes("kimi")));
});

test("/model onPick safely switches provider with preset", async () => {
  const previous = process.env.MOONSHOT_API_KEY;
  process.env.MOONSHOT_API_KEY = "sk-moon-test-key";
  const specs = [];
  const { context, state } = createContext({
    provider: "deepseek",
    model: "deepseek-flash",
  });
  context.openOptionPicker = (spec) => {
    specs.push(spec);
  };

  try {
    await modelCommand.execute([], context);
    assert.equal(specs.length, 1);

    // Pick Kimi preset
    const kimiItem = specs[0].items.find((item) => item.id === "moonshot");
    assert.ok(kimiItem, "moonshot item must exist");
    await specs[0].onPick(kimiItem);

    assert.equal(state.provider, "moonshot");
    assert.equal(state.model, "kimi-k3");
    assert.equal(state.apiKey, "sk-moon-test-key");
  } finally {
    if (previous === undefined) delete process.env.MOONSHOT_API_KEY;
    else process.env.MOONSHOT_API_KEY = previous;
  }
});

test("/model list --current filters only to current provider", async () => {
  const specs = [];
  const { context } = createContext({
    provider: "deepseek",
    model: "deepseek-flash",
  });
  context.openOptionPicker = (spec) => {
    specs.push(spec);
  };

  await modelCommand.execute(["list", "--current"], context);
  assert.equal(specs.length, 1);
  const spec = specs[0];
  assert.equal(spec.title, "模型切换 · deepseek");
  const blob = spec.items.map((i) => `${i.id} ${i.label}`).join("\n");
  assert.match(blob, /deepseek/);
  assert.doesNotMatch(blob, /openai|moonshot|qwen|glm/i);
});


test("Mistral AI provider contains codestral and hosted deepseek-v4-1-flash-1017", () => {
  const sections = listAllGroupedProviderModelEntries("mistral", "deepseek-v4-1-flash-1017");
  const mistral = sections.find((s) => s.providerId === "mistral");
  assert.ok(mistral, "Mistral AI section must exist");
  assert.equal(mistral.isCurrent, true);
  assert.equal(mistral.displayName, "Mistral AI");

  const models = mistral.entries.map((e) => e.model);
  assert.ok(models.includes("codestral-latest"), "Should include codestral-latest");
  assert.ok(models.includes("deepseek-v4-1-flash-1017"), "Should include deepseek-v4-1-flash-1017");
  assert.ok(models.includes("mistral-large-latest"), "Should include mistral-large-latest");
  assert.ok(models.includes("zai-glm-5-3"), "Should include zai-glm-5-3");

  // DeepSeek native section does NOT contain mistral's hosted deepseek model
  const deepseek = sections.find((s) => s.providerId === "deepseek");
  assert.ok(deepseek);
  const deepseekModels = deepseek.entries.map((e) => e.model);
  assert.ok(!deepseekModels.includes("deepseek-v4-1-flash-1017"));
});
