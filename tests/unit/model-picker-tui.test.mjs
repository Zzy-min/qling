import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGroupedModelPickerSpec,
  formatGroupedModelPickerLines,
} from "../../dist/tui/model-picker.js";
import { isProviderCredentialReady } from "../../dist/providers/resolve-llm.js";

test("isProviderCredentialReady correctly reports status for providers", () => {
  // 1. Ollama is keyless
  const ollama = isProviderCredentialReady("ollama", {});
  assert.equal(ollama.ready, true);
  assert.equal(ollama.requiresKey, false);
  assert.equal(ollama.badge, "⚡ 免Key");

  // 2. DeepSeek with DEEPSEEK_API_KEY
  const dsReady = isProviderCredentialReady("deepseek", { DEEPSEEK_API_KEY: "sk-ds-key" });
  assert.equal(dsReady.ready, true);
  assert.equal(dsReady.badge, "✓ 已就绪");

  // 3. DeepSeek without key
  const dsMissing = isProviderCredentialReady("deepseek", {});
  assert.equal(dsMissing.ready, false);
  assert.equal(dsMissing.badge, "○ 需配Key");
  assert.match(dsMissing.message, /DEEPSEEK_API_KEY/);

  // 4. Managed account connection
  const chatgpt = isProviderCredentialReady("chatgpt", {});
  assert.equal(chatgpt.ready, true);
  assert.equal(chatgpt.badge, "🔒 账号");
});

test("buildGroupedModelPickerSpec creates filterable grouped spec with sections and badges", () => {
  const notices = [];
  const errors = [];
  const spec = buildGroupedModelPickerSpec({
    currentProvider: "deepseek",
    currentModel: "deepseek-flash",
    callbacks: {
      applyModel: async () => {},
      applyPreset: async () => {},
      writeNotice: (msg) => notices.push(msg),
      writeError: (msg) => errors.push(msg),
    },
    env: {
      DEEPSEEK_API_KEY: "sk-test",
    },
  });

  assert.equal(spec.title, "模型切换 · 按服务商浏览");
  assert.equal(spec.filterable, true);
  assert.ok(spec.items.length > 10);

  // DeepSeek section header
  const dsSection = spec.items.find((item) => item.id === "section:deepseek");
  assert.ok(dsSection, "DeepSeek section header should exist");
  assert.equal(dsSection.section, true);
  assert.equal(dsSection.collapsible, true);
  assert.equal(dsSection.tag, "★ 当前");

  // Models under deepseek
  const flashItem = spec.items.find((item) => item.id === "deepseek");
  assert.ok(flashItem, "deepseek preset item should exist");
  assert.equal(flashItem.active, true);
  assert.match(flashItem.description, /1M ctx/);
  assert.match(flashItem.description, /393k out/);

  // Aliases for filtering
  assert.ok(flashItem.aliases.includes("deepseek"));
  assert.ok(flashItem.aliases.includes("deepseek-flash"));

  // Check another section has credential badge
  const dashscopeSection = spec.items.find((item) => item.id === "section:dashscope");
  assert.ok(dashscopeSection);
  assert.equal(dashscopeSection.tag, "○ 需配Key");
});

test("buildGroupedModelPickerSpec filters to current provider when requested", () => {
  const spec = buildGroupedModelPickerSpec({
    currentProvider: "deepseek",
    currentModel: "deepseek-flash",
    filterCurrentProviderOnly: true,
    callbacks: {
      applyModel: async () => {},
      applyPreset: async () => {},
      writeNotice: () => {},
      writeError: () => {},
    },
  });

  assert.equal(spec.title, "模型切换 · deepseek");
  const sections = spec.items.filter((item) => item.section);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].id, "section:deepseek");
});

test("buildGroupedModelPickerSpec onPick dispatches correctly", async () => {
  let appliedPreset = null;
  let appliedModel = null;
  let appliedSession = null;

  const spec = buildGroupedModelPickerSpec({
    currentProvider: "deepseek",
    currentModel: "deepseek-flash",
    callbacks: {
      applyModel: async (m) => { appliedModel = m; },
      applyPreset: async (p) => { appliedPreset = p; },
      applyLlmSession: async (s) => { appliedSession = s; },
      writeNotice: () => {},
      writeError: () => {},
    },
    env: {
      MOONSHOT_API_KEY: "sk-moon-pick",
    },
  });

  // Picking a section header does nothing
  const sec = spec.items.find((item) => item.section);
  await spec.onPick(sec);
  assert.equal(appliedPreset, null);
  assert.equal(appliedModel, null);

  // Picking a preset
  const dsItem = spec.items.find((item) => item.id === "deepseek");
  await spec.onPick(dsItem);
  assert.equal(appliedPreset, "deepseek");

  // Picking a model across providers with session
  const kimiItem = spec.items.find((item) => item.id === "model:kimi-k2.7-code");
  if (kimiItem) {
    await spec.onPick(kimiItem);
    assert.ok(appliedSession, "Should have applied LLM session across provider");
    assert.equal(appliedSession.provider, "moonshot");
    assert.equal(appliedSession.model, "kimi-k2.7-code");
    assert.equal(appliedSession.apiKey, "sk-moon-pick");
  }
});

test("formatGroupedModelPickerLines outputs readable categorized lines", () => {
  const lines = formatGroupedModelPickerLines("deepseek", "deepseek-flash", {
    DEEPSEEK_API_KEY: "sk-ds-key",
  });
  const text = lines.join("\n");
  assert.match(text, /全部模型提供商/);
  assert.match(text, /DeepSeek ★ 当前/);
  assert.match(text, /deepseek-flash/);
  assert.match(text, /1M ctx/);
  assert.match(text, /阿里云百炼/);
});

test("buildGroupedModelPickerSpec provides shorthand provider aliases for search", () => {
  const spec = buildGroupedModelPickerSpec({
    currentProvider: "deepseek",
    currentModel: "deepseek-flash",
    callbacks: {
      applyModel: async () => {},
      applyPreset: async () => {},
      writeNotice: () => {},
      writeError: () => {},
    },
  });

  const dsItem = spec.items.find((item) => item.id === "deepseek");
  assert.ok(dsItem);
  assert.ok(dsItem.aliases.includes("ds"), "DeepSeek item should have 'ds' alias");
  assert.ok(dsItem.aliases.includes("deepseek"));

  const qwenItem = spec.items.find((item) => item.id === "dashscope");
  assert.ok(qwenItem);
  assert.ok(qwenItem.aliases.includes("qwen"), "DashScope item should have 'qwen' alias");
  assert.ok(qwenItem.aliases.includes("aliyun"), "DashScope item should have 'aliyun' alias");

  const moonshotItem = spec.items.find((item) => item.id === "moonshot");
  assert.ok(moonshotItem);
  assert.ok(moonshotItem.aliases.includes("kimi"), "Moonshot item should have 'kimi' alias");

  const claudeItem = spec.items.find((item) => item.id === "anthropic");
  assert.ok(claudeItem);
  assert.ok(claudeItem.aliases.includes("claude"), "Anthropic item should have 'claude' alias");
});

test("cross-provider model switch without applyLlmSession errors and never calls applyModel", async () => {
  let appliedModel = null;
  const errors = [];
  const spec = buildGroupedModelPickerSpec({
    currentProvider: "deepseek",
    currentModel: "deepseek-flash",
    callbacks: {
      applyModel: async (m) => { appliedModel = m; },
      applyPreset: async () => {},
      writeNotice: () => {},
      writeError: (err) => errors.push(err),
    },
    env: {
      DASHSCOPE_API_KEY: "sk-dash-test",
    },
  });

  const qwenModelItem = spec.items.find((item) => item.id === "model:qwen-plus");
  assert.ok(qwenModelItem, "qwen-plus model item should exist");
  await spec.onPick(qwenModelItem);

  assert.equal(appliedModel, null, "applyModel must NOT be called for cross-provider switch without applyLlmSession");
  assert.ok(errors.some((e) => /不支持跨服务商/.test(e)));
});

