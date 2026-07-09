import test from "node:test";
import assert from "node:assert/strict";

import {
  apiKeyRequiredForEndpoint,
  getProviderPreset,
  isLoopbackEndpoint,
  listProviderPresets,
  resolveModelCandidates,
} from "../../dist/providers/presets.js";

test("listProviderPresets returns ordered core presets including ollama", () => {
  const list = listProviderPresets();
  assert.ok(list.length >= 10);
  assert.equal(list[0].id, "deepseek");
  assert.ok(list.some((p) => p.id === "ollama"));
  assert.ok(list.every((p) => p.endpoint && p.model && p.provider));
});

test("getProviderPreset resolves id, alias, and 1-based index", () => {
  assert.equal(getProviderPreset("ollama")?.provider, "ollama");
  assert.equal(getProviderPreset("local")?.endpoint, "http://localhost:11434/v1");
  assert.equal(getProviderPreset("1")?.id, "deepseek");
  assert.equal(getProviderPreset("10")?.id, "ollama");
  assert.equal(getProviderPreset("kimi")?.id, "moonshot");
  assert.equal(getProviderPreset("nope"), undefined);
});

test("resolveModelCandidates is unique and non-empty", () => {
  const models = resolveModelCandidates();
  assert.ok(models.includes("deepseek-chat"));
  assert.ok(models.includes("llama3"));
  assert.equal(new Set(models).size, models.length);
});

test("loopback endpoint does not require API key", () => {
  assert.equal(isLoopbackEndpoint("http://localhost:11434/v1"), true);
  assert.equal(isLoopbackEndpoint("http://127.0.0.1:11434/v1"), true);
  assert.equal(isLoopbackEndpoint("https://api.deepseek.com"), false);
  assert.equal(apiKeyRequiredForEndpoint("http://localhost:11434/v1", "ollama"), false);
  assert.equal(apiKeyRequiredForEndpoint("https://api.deepseek.com", "deepseek"), true);
});
