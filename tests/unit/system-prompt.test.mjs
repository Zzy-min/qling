import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import {
  buildRuntimeMetaSection,
  buildPromptInspectSnapshot,
  buildMandatoryRulesReference,
  assembleSystemPrompt,
  findLastUserMessageContent,
  heuristicReflect,
  sanitizeWorkspaceLabel,
} from "../../dist/agent/system-prompt.js";
import { buildDefaultRegistry } from "../../dist/pipeline/sections.js";
import {
  formatMandatoryRulesBlock,
  loadMandatoryRuleFiles,
} from "../../dist/agent/rule-files.js";

test("findLastUserMessageContent returns last user text", () => {
  assert.equal(
    findLastUserMessageContent([
      { role: "user", content: "one" },
      { role: "assistant", content: "a" },
      { role: "user", content: "two" },
    ]),
    "two"
  );
  assert.equal(findLastUserMessageContent([]), "");
});

test("sanitizeWorkspaceLabel is cross-platform", () => {
  assert.equal(sanitizeWorkspaceLabel("C:\\repo"), "repo");
  assert.equal(sanitizeWorkspaceLabel("C:/repo"), "repo");
  assert.equal(sanitizeWorkspaceLabel("/home/u/project"), "project");
  assert.equal(sanitizeWorkspaceLabel("repo"), "repo");
  assert.equal(sanitizeWorkspaceLabel(""), "(disabled)");
  assert.equal(sanitizeWorkspaceLabel(null), "(disabled)");
});

test("buildRuntimeMetaSection exposes only sanitized local runtime labels", () => {
  const text = buildRuntimeMetaSection({
    provider: "deepseek",
    endpoint: "https://api.example.com",
    workspaceDir: "C:\\repo",
    fileCacheDir: "C:\\cache",
    fileStateDir: "C:\\state",
    runtimeRootDir: "C:\\qling",
  });
  assert.match(text, /<user_info>/);
  assert.match(text, /workspace=repo/);
  assert.doesNotMatch(text, /deepseek|api\.example/);
  // 不得泄漏完整盘符路径（跨平台）
  assert.doesNotMatch(text, /C:\\repo|C:\\cache|C:\\state|C:\/repo/);
});

test("buildRuntimeMetaSection sanitizes posix workspace paths", () => {
  const text = buildRuntimeMetaSection({
    workspaceDir: "/var/workspaces/my-app",
    runtimeRootDir: "/home/user/.qling",
  });
  assert.match(text, /workspace=my-app/);
  assert.doesNotMatch(text, /\/var\/workspaces/);
});

test("findLastUserMessageContent ignores synthetic user messages", () => {
  assert.equal(
    findLastUserMessageContent([
      { role: "user", content: "real" },
      { role: "user", content: "runtime", synthetic_reason: "runtime_environment" },
    ]),
    "real"
  );
});

test("prompt inspect snapshot hashes only the stable prompt and reports layer sizes", () => {
  const first = buildPromptInspectSnapshot("stable", [
    { role: "user", content: "runtime", synthetic_reason: "runtime_environment" },
    { role: "user", content: "dynamic", synthetic_reason: "dynamic_context" },
  ]);
  const second = buildPromptInspectSnapshot("stable", [
    { role: "user", content: "runtime changed", synthetic_reason: "runtime_environment" },
  ]);
  assert.equal(first.staticHash, second.staticHash);
  assert.equal(first.staticChars, 6);
  assert.equal(first.runtimeChars, 7);
  assert.equal(first.dynamicChars, 7);
});

test("heuristicReflect warns on destructive shell", () => {
  const warn = heuristicReflect({
    id: "1",
    name: "bash",
    arguments: { cmd: "rm -rf /tmp/x" },
  });
  assert.equal(warn.decision, "warn");
  const ok = heuristicReflect({
    id: "2",
    name: "bash",
    arguments: { cmd: "npm test" },
  });
  assert.equal(ok.decision, "proceed");
});

test("mandatory rules use a compact dynamic reference", () => {
  const fullRules = "必须验证后再报告。".repeat(1000);
  const reference = buildMandatoryRulesReference(fullRules);
  assert.ok(reference.length < 220);
  assert.match(reference, /system/);
  assert.doesNotMatch(reference, /必须验证后再报告。必须验证后再报告。/);
});

test("assembled prompt contains one full mandatory-rules copy", async () => {
  const messages = [];
  const stateDir = path.join(os.homedir(), ".qling");
  const rules = formatMandatoryRulesBlock(await loadMandatoryRuleFiles({
    workspaceDir: process.cwd(),
    stateDir,
    homeDir: os.homedir(),
  }));
  const systemPrompt = await assembleSystemPrompt({
    baseSystemPrompt: "base",
    sectionRegistry: buildDefaultRegistry([]),
    memoryStore: { getRelevant: async () => [] },
    messages,
    workspaceDir: process.cwd(),
    runtimeRootDir: process.cwd(),
  });
  assert.equal(systemPrompt.split(rules).length - 1, 1);
  const dynamic = messages.find((message) => message.synthetic_reason === "dynamic_context");
  assert.match(dynamic?.content ?? "", /<mandatory_rules_ref/);
  assert.doesNotMatch(dynamic?.content ?? "", /<mandatory_rules priority=/);
  assert.equal((dynamic?.content ?? "").includes(rules), false);
});
