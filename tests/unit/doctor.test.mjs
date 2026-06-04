import test from "node:test";
import assert from "node:assert/strict";

import { buildDoctorReport, formatDoctorReport } from "../../dist/doctor.js";

function createContext(overrides = {}) {
  return {
    workspaceDir: "C:\\repo\\qingling",
    agentLoop: {
      getSessionId: () => "session-test",
      getSessionStats: () => ({ sessionId: "session-test", turnCount: 2, tokens: 100 }),
      getPermissionMode: () => "ask",
      ...overrides.agentLoop,
    },
    ...overrides,
  };
}

test("doctor report summarizes healthy local checks", async () => {
  const report = await buildDoctorReport(createContext(), {
    env: {
      QINGLING_FILE_STATE_DIR: "C:\\Users\\Lenovo\\.qingling",
      QINGLING_FILE_CACHE_DIR: "C:\\Users\\Lenovo\\.qingling\\cache",
      QINGLING_LLM_PROVIDER: "deepseek",
      QINGLING_LLM_MODEL: "deepseek-chat",
      QINGLING_LLM_ENDPOINT: "https://api.deepseek.com",
      QINGLING_LLM_API_KEY: "sk-test",
    },
    exists: () => true,
    gitBranch: () => "main",
    nodeVersion: "22.22.1",
    daemonProbe: async () => ({ ok: true, detail: "running" }),
  });

  assert.equal(report.summary.fail, 0);
  assert.equal(report.summary.warn, 0);
  assert.ok(report.summary.pass >= 10);
  assert.equal(report.checks.find((check) => check.id === "daemon")?.status, "pass");
});

test("doctor report includes config mcp and hooks summaries without leaking secrets", async () => {
  const report = await buildDoctorReport(createContext(), {
    env: {
      QINGLING_FILE_STATE_DIR: "C:\\Users\\Lenovo\\.qingling",
      QINGLING_FILE_CACHE_DIR: "C:\\Users\\Lenovo\\.qingling\\cache",
      QINGLING_LLM_PROVIDER: "deepseek",
      QINGLING_LLM_MODEL: "doctor-model",
      QINGLING_LLM_ENDPOINT: "https://user:pass@example.com/v1?token=DOCTOR_ENDPOINT_SECRET#frag",
      QINGLING_LLM_API_KEY: "sk-doctor-secret",
      QINGLING_MCP_CONNECTION_TIMEOUT_MS: "1111",
      QINGLING_MCP_CALL_TIMEOUT_MS: "2222",
      QINGLING_MCP_SERVERS: JSON.stringify({
        docs: {
          enabled: true,
          transport: "http",
          url: "https://user:pass@mcp.example.com/mcp?token=DOCTOR_MCP_SECRET",
          headers: { Authorization: "Bearer DOCTOR_HEADER_SECRET" },
          command: "",
          args: [],
        },
      }),
      QINGLING_GUARD_ENABLED: "true",
      QINGLING_GUARD_PERMISSIONS_DEFAULT: "ask",
      QINGLING_GUARD_PERMISSIONS_RULES: JSON.stringify([
        { tool_pattern: "bash", decision: "deny", reason: "DOCTOR_PERMISSION_REASON" },
      ]),
      QINGLING_GUARD_RATE_LIMIT_ENABLED: "true",
      QINGLING_GUARD_RATE_LIMIT_MAX_PER_MINUTE: "9",
      QINGLING_GUARD_CONTENT_FILTER_ENABLED: "true",
      QINGLING_GUARD_CONTENT_FILTER_CUSTOM: JSON.stringify(["DOCTOR_CUSTOM_PATTERN"]),
    },
    exists: () => true,
    gitBranch: () => "main",
    nodeVersion: "22.22.1",
    daemonProbe: async () => ({ ok: true, detail: "running" }),
  });
  const text = formatDoctorReport(report).join("\n");

  assert.equal(report.checks.find((check) => check.id === "config")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "mcp")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "hooks")?.status, "pass");
  assert.match(text, /config/);
  assert.match(text, /provider=deepseek/);
  assert.match(text, /model=doctor-model/);
  assert.match(text, /endpoint=https:\/\/example\.com\/v1/);
  assert.match(text, /api_key=set\(redacted\)/);
  assert.match(text, /MCP.*enabled=1\/1/);
  assert.match(text, /connect=1111ms call=2222ms/);
  assert.match(text, /hooks.*guard=on/);
  assert.match(text, /permission=ask rules=1/);
  assert.match(text, /custom=1/);
  assert.doesNotMatch(text, /sk-doctor-secret/);
  assert.doesNotMatch(text, /DOCTOR_ENDPOINT_SECRET/);
  assert.doesNotMatch(text, /DOCTOR_MCP_SECRET/);
  assert.doesNotMatch(text, /DOCTOR_HEADER_SECRET/);
  assert.doesNotMatch(text, /DOCTOR_PERMISSION_REASON/);
  assert.doesNotMatch(text, /DOCTOR_CUSTOM_PATTERN/);
  assert.doesNotMatch(text, /user:pass/);
});

test("doctor report warns for missing local data directories", async () => {
  const report = await buildDoctorReport(createContext(), {
    env: {
      QINGLING_FILE_STATE_DIR: "C:\\Users\\Lenovo\\.qingling",
      QINGLING_FILE_CACHE_DIR: "C:\\Users\\Lenovo\\.qingling\\cache",
    },
    exists: (path) => !String(path).includes("cache"),
    gitBranch: () => "main",
    nodeVersion: "22.22.1",
    daemonProbe: async () => ({ ok: true, detail: "running" }),
  });

  assert.equal(report.checks.find((check) => check.id === "cache_dir")?.status, "warn");
  assert.equal(report.summary.fail, 0);
});

test("doctor report treats daemon probe failure as warn", async () => {
  const report = await buildDoctorReport(createContext(), {
    env: {},
    exists: () => true,
    gitBranch: () => null,
    nodeVersion: "22.22.1",
    daemonProbe: async () => ({ ok: false, detail: "not running" }),
  });

  assert.equal(report.checks.find((check) => check.id === "daemon")?.status, "warn");
  assert.equal(report.summary.fail, 0);
});

test("doctor config check warns when api key is missing", async () => {
  const report = await buildDoctorReport(createContext(), {
    env: {
      QINGLING_LLM_PROVIDER: "deepseek",
      QINGLING_LLM_MODEL: "deepseek-chat",
      QINGLING_LLM_ENDPOINT: "https://api.deepseek.com",
      QINGLING_LLM_API_KEY: undefined,
    },
    exists: () => true,
    gitBranch: () => "main",
    nodeVersion: "22.22.1",
    daemonProbe: async () => ({ ok: true, detail: "running" }),
  });

  const config = report.checks.find((check) => check.id === "config");
  assert.equal(config?.status, "warn");
  assert.match(config?.detail ?? "", /api_key=missing/);
});

test("doctor formatter emits readable local diagnostics", async () => {
  const report = await buildDoctorReport(createContext(), {
    env: {},
    exists: () => true,
    gitBranch: () => "main",
    nodeVersion: "22.22.1",
    daemonProbe: async () => ({ ok: true, detail: "running" }),
  });
  const text = formatDoctorReport(report).join("\n");

  assert.match(text, /轻灵 Doctor/);
  assert.match(text, /Node/);
  assert.match(text, /workspace/);
  assert.match(text, /config/);
  assert.match(text, /MCP/);
  assert.match(text, /hooks/);
  assert.match(text, /本地/);
});
