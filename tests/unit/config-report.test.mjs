import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLocalConfigReport,
  formatLocalConfigReport,
  sanitizeEndpoint,
} from "../../dist/config-report.js";

function createConfig(overrides = {}) {
  return {
    llm: {
      provider: "deepseek",
      model: "deepseek-chat",
      endpoint: "https://user:pass@example.com/v1?api_key=SECRET#frag",
      api_key: "sk-local-secret",
      request_timeout_ms: 120000,
    },
    runtime: {
      workspace_dir: "C:/repo/qling",
      file_cache_dir: "C:/state/cache",
      file_state_dir: "C:/state",
      max_steps: 20,
      parse_retries: 2,
      max_token_budget: 100000,
      tool_repeat_limit: 3,
      timeout_ms: 600000,
    },
    features: {
      semantic_memory: true,
      workflow_runtime: true,
      vision_tool: false,
      dashboard: true,
      dynamic_discovery: false,
      tool_spec_boost: true,
    },
    logging: {
      level: "info",
      format: "text",
      inspect_prompt: false,
      inspect_request: true,
      inspect_dump_dir: "C:/state/inspect",
    },
    guard: {
      permissions: {
        default: "ask",
        rules: [{ tool_pattern: "bash", decision: "ask", reason: "review shell" }],
      },
    },
    agents: {
      isolation: {
        mode: "worktree",
        require_git: true,
        non_git_policy: "warn",
      },
    },
    mcp: {
      servers: {
        github: { enabled: true },
        exa: { enabled: false },
      },
    },
    channels: {
      default: "console",
    },
    ...overrides,
  };
}

test("config report redacts api key and endpoint credentials", () => {
  const report = buildLocalConfigReport(createConfig());
  const text = formatLocalConfigReport(report).join("\n");

  assert.match(text, /本地配置摘要/);
  assert.match(text, /Api key\s*: set\(redacted\)/);
  assert.match(text, /Endpoint\s*: https:\/\/example\.com\/v1/);
  assert.doesNotMatch(text, /sk-local-secret/);
  assert.doesNotMatch(text, /user:pass/);
  assert.doesNotMatch(text, /SECRET/);
  assert.doesNotMatch(text, /api_key/);
});

test("config report shows missing api key", () => {
  const config = createConfig({
    llm: {
      ...createConfig().llm,
      api_key: "",
    },
  });
  const text = formatLocalConfigReport(buildLocalConfigReport(config)).join("\n");

  assert.match(text, /Api key\s*: missing/);
});

test("config report includes runtime permissions features and local boundary", () => {
  const text = formatLocalConfigReport(buildLocalConfigReport(createConfig())).join("\n");

  assert.match(text, /Provider\s*: deepseek/);
  assert.match(text, /Model\s*: deepseek-chat/);
  assert.match(text, /Workspace\s*: C:\/repo\/qling/);
  assert.match(text, /State dir\s*: C:\/state/);
  assert.match(text, /Cache dir\s*: C:\/state\/cache/);
  assert.match(text, /Permissions\s*: ask\(确认\)/);
  assert.match(text, /Rules\s*: 1/);
  assert.match(text, /semantic_memory=on/);
  assert.match(text, /vision_tool=off/);
  assert.match(text, /Isolation\s*: mode=worktree require_git=true non_git=warn/);
  assert.match(text, /只读取当前本地配置/);
});

test("endpoint sanitizer redacts query-like secrets for non-url input", () => {
  assert.equal(sanitizeEndpoint("localhost:8080?token=abc&x=1"), "localhost:8080?token=<redacted>&x=1");
  assert.equal(sanitizeEndpoint(""), "-");
});
