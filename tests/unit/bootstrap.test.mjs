import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBootstrapReport,
  formatBootstrapReport,
  parseBootstrapArgs,
} from "../../dist/cli/bootstrap.js";

test("bootstrap args default to minimal local profile without browser install", () => {
  const parsed = parseBootstrapArgs([]);

  assert.deepEqual(parsed, {
    yes: false,
    browser: "auto",
    profile: "minimal",
  });
});

test("bootstrap args accept yes browser and dev profile", () => {
  const parsed = parseBootstrapArgs(["--yes", "--with-browser", "--profile", "dev"]);

  assert.deepEqual(parsed, {
    yes: true,
    browser: "with",
    profile: "dev",
  });
});

test("bootstrap report guides missing api key and optional browser install", () => {
  const report = buildBootstrapReport({
    args: parseBootstrapArgs(["--no-browser"]),
    env: {
      QLING_LLM_PROVIDER: "deepseek",
      QLING_LLM_MODEL: "deepseek-chat",
      QLING_LLM_ENDPOINT: "https://api.deepseek.com",
    },
    stateDir: "C:\\Users\\Lenovo\\.qling",
    nodeVersion: "22.0.0",
    npmVersion: "10.0.0",
  });
  const text = formatBootstrapReport(report).join("\n");

  assert.equal(report.profile, "minimal");
  assert.equal(report.advancedDefaults.dashboard, false);
  assert.equal(report.advancedDefaults.semanticMemory, false);
  assert.equal(report.advancedDefaults.dynamicDiscovery, false);
  assert.match(text, /qling setup/);
  assert.match(text, /--with-browser/);
  assert.match(text, /不调用模型/);
  assert.doesNotMatch(text, /sk-/);
});

test("bootstrap dev profile advertises advanced local options without enabling them", () => {
  const report = buildBootstrapReport({
    args: parseBootstrapArgs(["--profile=dev", "--with-browser"]),
    env: { QLING_LLM_API_KEY: "sk-secret" },
    stateDir: "C:\\Users\\Lenovo\\.qling",
    nodeVersion: "22.0.0",
    npmVersion: "10.0.0",
  });
  const text = formatBootstrapReport(report).join("\n");

  assert.equal(report.profile, "dev");
  assert.equal(report.advancedDefaults.dashboard, false);
  assert.match(text, /dev/);
  assert.match(text, /dashboard|semantic|discovery/i);
  assert.doesNotMatch(text, /sk-secret/);
});
