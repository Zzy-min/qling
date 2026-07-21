import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatMandatoryRulesBlock,
  loadMandatoryRuleFiles,
  ruleFileCandidates,
} from "../../dist/agent/rule-files.js";

describe("mandatory rule files", () => {
  it("includes user-rules and AGENTS candidates", () => {
    const list = ruleFileCandidates({
      workspaceDir: "C:\\repo",
      stateDir: "C:\\Users\\x\\.qling",
      homeDir: "C:\\Users\\x",
    });
    assert.ok(list.some((p) => p.includes("user-rules.md")));
    assert.ok(list.some((p) => p.endsWith("AGENTS.md") || p.endsWith("Agents.md")));
  });

  it("formats hard-constraint block", () => {
    const block = formatMandatoryRulesBlock([
      { source: "/tmp/user-rules.md", content: "诚实大于安全" },
    ]);
    assert.match(block, /MANDATORY RULES/);
    assert.match(block, /硬约束/);
    assert.match(block, /诚实大于安全/);
  });

  it("loads real user home rules when present", async () => {
    const files = await loadMandatoryRuleFiles({
      workspaceDir: process.env.USERPROFILE || process.env.HOME,
      stateDir: (process.env.USERPROFILE || process.env.HOME) + "/.qling",
    });
    // 本机应至少有 user-rules 或 Agents.md
    assert.ok(files.length >= 1, "expected at least one rule file on this machine");
    const block = formatMandatoryRulesBlock(files);
    assert.match(block, /强制用户规则/);
  });
});
