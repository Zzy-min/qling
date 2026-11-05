import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("loads home rules from an isolated fixture", async () => {
    const home = await mkdtemp(join(tmpdir(), "qling-rule-home-"));
    try {
    await writeFile(join(home, "AGENTS.md"), "fixture-home-rule");
    const files = await loadMandatoryRuleFiles({
      workspaceDir: home,
      stateDir: join(home, ".qling"),
      homeDir: home,
    });
    assert.equal(files.length, 1);
    assert.equal(files[0].content, "fixture-home-rule");
    const block = formatMandatoryRulesBlock(files);
    assert.match(block, /强制用户规则/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("loads distinct rule filenames on case-sensitive filesystems", async (context) => {
    const home = await mkdtemp(join(tmpdir(), "qling-rule-case-"));
    try {
      await writeFile(join(home, "Agents.md"), "mixed-case-rule");
      await writeFile(join(home, "AGENTS.md"), "upper-case-rule");
      if (await readFile(join(home, "Agents.md"), "utf8") !== "mixed-case-rule") {
        context.skip("fixture filesystem does not distinguish case");
        return;
      }
      const files = await loadMandatoryRuleFiles({ homeDir: home, workspaceDir: home, stateDir: join(home, ".qling") });
      assert.deepEqual(files.map((file) => file.content).sort(), ["mixed-case-rule", "upper-case-rule"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
