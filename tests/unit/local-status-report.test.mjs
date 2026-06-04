import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildDefaultConfig } from "../../dist/config.js";
import { buildLocalStatusReport, formatLocalStatusReport } from "../../dist/local-status-report.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "qingling-local-status-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("local status report summarizes local config and storage metadata without leaking bodies", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "sessions"), { recursive: true });
    await mkdir(join(dir, "exports"), { recursive: true });
    await writeFile(join(dir, "sessions", "session.json"), "SECRET_SESSION_BODY", "utf8");
    await writeFile(join(dir, "exports", "export.md"), "SECRET_EXPORT_BODY", "utf8");

    const config = buildDefaultConfig();
    config.llm.provider = "deepseek";
    config.llm.model = "status-model";
    config.llm.endpoint = "https://user:pass@example.com/v1?token=STATUS_ENDPOINT_SECRET#frag";
    config.llm.api_key = "sk-status-secret";
    config.runtime.workspace_dir = "C:/repo/qingling";
    config.runtime.file_state_dir = dir;
    config.runtime.file_cache_dir = join(dir, "cache");
    config.guard.permissions.default = "ask";
    config.guard.enabled = true;
    config.mcp.servers = {
      docs: {
        command: "",
        args: [],
        enabled: true,
        transport: "http",
        url: "https://user:pass@mcp.example.com/mcp?token=STATUS_MCP_SECRET",
      },
    };

    const report = await buildLocalStatusReport(config, {
      gitBranch: () => "main",
    });
    const text = formatLocalStatusReport(report).join("\n");

    assert.match(text, /本地状态/);
    assert.match(text, /provider=deepseek/);
    assert.match(text, /model=status-model/);
    assert.match(text, /endpoint=https:\/\/example\.com\/v1/);
    assert.match(text, /api_key=set\(redacted\)/);
    assert.match(text, /branch=main/);
    assert.match(text, /sessions=1/);
    assert.match(text, /exports=1/);
    assert.match(text, /permission=ask/);
    assert.match(text, /MCP=1\/1/);
    assert.match(text, /hooks=on/);
    assert.doesNotMatch(text, /sk-status-secret/);
    assert.doesNotMatch(text, /STATUS_ENDPOINT_SECRET/);
    assert.doesNotMatch(text, /STATUS_MCP_SECRET/);
    assert.doesNotMatch(text, /SECRET_SESSION_BODY/);
    assert.doesNotMatch(text, /SECRET_EXPORT_BODY/);
    assert.doesNotMatch(text, /user:pass/);
  });
});

test("local status report handles missing sessions and exports directories", async () => {
  await withTempDir(async (dir) => {
    const config = buildDefaultConfig();
    config.runtime.file_state_dir = dir;
    config.runtime.file_cache_dir = join(dir, "cache");
    config.llm.api_key = "";

    const report = await buildLocalStatusReport(config, {
      gitBranch: () => null,
    });
    const text = formatLocalStatusReport(report).join("\n");

    assert.equal(report.sessionsCount, 0);
    assert.equal(report.exportsCount, 0);
    assert.match(text, /sessions=0/);
    assert.match(text, /exports=0/);
    assert.match(text, /api_key=missing/);
    assert.match(text, /branch=-/);
  });
});
