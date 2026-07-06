import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSetupEnvLines,
  formatSetupApiKeyInstructions,
} from "../../dist/cli/setup.js";

test("setup env lines persist only non-sensitive provider config", () => {
  const lines = buildSetupEnvLines({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com",
    model: "deepseek-chat",
  });
  const text = lines.join("\n");

  assert.match(text, /QLING_LLM_PROVIDER=deepseek/);
  assert.match(text, /QLING_LLM_ENDPOINT=https:\/\/api\.deepseek\.com/);
  assert.match(text, /QLING_LLM_MODEL=deepseek-chat/);
  assert.doesNotMatch(text, /API_KEY/);
  assert.doesNotMatch(text, /sk-/);
  // 仅保留 provider/model/endpoint 和高级非敏感开关
  assert.doesNotMatch(text, /VISION|SEMANTIC|KEY/i);
});

test("setup api key instructions recommend system env without echoing secrets", () => {
  const text = formatSetupApiKeyInstructions(true).join("\n");

  assert.match(text, /未写入 \.env/);
  assert.match(text, /SetEnvironmentVariable/);
  assert.match(text, /QLING_LLM_API_KEY/);
  assert.match(text, /系统环境变量/);
  assert.doesNotMatch(text, /sk-/);
  assert.match(text, /绝不写入任何 .env/);
});

test("setup key instructions when key not provided still safe", () => {
  const text = formatSetupApiKeyInstructions(false).join("\n");
  assert.match(text, /未配置；需要调用模型前请先设置系统环境变量/);
  assert.doesNotMatch(text, /sk-/);
});
