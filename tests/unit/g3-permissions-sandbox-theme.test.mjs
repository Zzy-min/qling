import test from "node:test";
import assert from "node:assert/strict";
import {
  getPermissionGrantStore,
  resetPermissionGrantStoreForTests,
  formatPermissionPipelineLines,
  PERMISSION_PIPELINE_STAGES,
} from "../../dist/guard/permission-grants.js";
import { HookManager } from "../../dist/pipeline/hooks.js";
import {
  resolveSandboxProfile,
  setSandboxProfile,
  isWriteBlockedByProfile,
  isPathAllowedUnderProfile,
  isBashCwdAllowed,
  parseSandboxProfile,
} from "../../dist/runtime/sandbox-profile.js";
import {
  setTheme,
  getActiveThemeId,
  TUI_COLORS,
  parseThemeId,
  reloadThemeFromEnv,
  listThemes,
} from "../../dist/tui/theme.js";
import path from "node:path";

test.afterEach(() => {
  resetPermissionGrantStoreForTests();
  setTheme("bamboo");
  delete process.env.QLING_SANDBOX_PROFILE;
  delete process.env.QLING_WRITE_SANDBOX;
});

function createHookManager(defaultDecision = "ask") {
  return new HookManager(
    [
      { name: "bash", description: "b", parameters: { type: "object", properties: {} } },
      { name: "read", description: "r", parameters: { type: "object", properties: {} } },
    ],
    {
      enabled: true,
      network: { url_fetch: { allowed_url_prefixes: [], deny_private_ips: true, follow_redirects: false } },
      redaction: { enabled: false, patterns: [] },
      audit: { jsonl_path: "" },
      rate_limit: { enabled: false, max_per_minute: 0 },
      content_filter: { enabled: false, pii_detection: false, injection_detection: false, custom_patterns: [] },
      permissions: { default: defaultDecision, rules: [] },
    }
  );
}

test("G3.3 pipeline stages are ordered and documented", () => {
  assert.ok(PERMISSION_PIPELINE_STAGES.length >= 6);
  assert.equal(PERMISSION_PIPELINE_STAGES[0].id, "plan");
  assert.equal(PERMISSION_PIPELINE_STAGES[2].id, "grant");
  const lines = formatPermissionPipelineLines().join("\n");
  assert.match(lines, /Remembered grant|grant/i);
});

test("G3.3 remembered grant skips ask on second evaluate", async () => {
  const hm = createHookManager("ask");
  const first = await hm.runPreHook({
    toolName: "bash",
    arguments: { command: "echo 1" },
    isReadOnly: false,
    isDestructive: false,
  });
  assert.equal(first.decision, "ask");

  getPermissionGrantStore().remember("bash", { reason: "test" });
  const second = await hm.runPreHook({
    toolName: "bash",
    arguments: { command: "echo 2" },
    isReadOnly: false,
    isDestructive: false,
  });
  assert.equal(second.decision, "allow");
});

test("G3.4 sandbox profiles", () => {
  assert.equal(parseSandboxProfile("read-only"), "read-only");
  assert.equal(parseSandboxProfile("strict"), "strict");

  setSandboxProfile("read-only");
  assert.equal(resolveSandboxProfile(), "read-only");
  assert.equal(isWriteBlockedByProfile("read-only"), true);

  setSandboxProfile("workspace");
  process.env.QLING_WORKSPACE_DIR = process.cwd();
  const inside = path.join(process.cwd(), "src", "x.ts");
  const outside = path.join(path.parse(process.cwd()).root, "tmp-outside-qling-test");
  assert.equal(isPathAllowedUnderProfile(inside, "workspace"), true);
  assert.equal(isPathAllowedUnderProfile(outside, "workspace"), false);
  assert.equal(isBashCwdAllowed(process.cwd(), "strict"), true);
  assert.equal(isWriteBlockedByProfile("workspace"), false);

  setSandboxProfile("off");
  assert.equal(resolveSandboxProfile(), "off");
  assert.equal(isPathAllowedUnderProfile(outside, "off"), true);
});

test("G3.5 theme packs switch colors", () => {
  assert.equal(listThemes().length, 3);
  assert.equal(parseThemeId("night"), "night");
  setTheme("bamboo");
  const bambooPrimary = TUI_COLORS.primary;
  setTheme("night");
  assert.equal(getActiveThemeId(), "night");
  assert.notEqual(TUI_COLORS.primary, bambooPrimary);
  setTheme("mono");
  assert.equal(getActiveThemeId(), "mono");
  process.env.QLING_TUI_THEME = "night";
  assert.equal(reloadThemeFromEnv(), "night");
  setTheme("bamboo");
});
