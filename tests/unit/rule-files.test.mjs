import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

  it("loads rule files from an explicit home fixture", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "qling-rules-home-"));
    const stateDir = path.join(home, ".qling");
    try {
      await fs.mkdir(path.join(stateDir, "memory"), { recursive: true });
      await fs.writeFile(path.join(stateDir, "memory", "user-rules.md"), "诚实大于安全\n");
      await fs.writeFile(path.join(home, "AGENTS.md"), "无新鲜验证不得声称完成\n");
      const files = await loadMandatoryRuleFiles({
        workspaceDir: home,
        stateDir,
        homeDir: home,
      });
      assert.ok(files.length >= 2, "expected fixture user-rules.md and AGENTS.md");
      const block = formatMandatoryRulesBlock(files);
      assert.match(block, /强制用户规则/);
      assert.match(block, /诚实大于安全/);
      assert.match(block, /无新鲜验证不得声称完成/);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it("keeps case-distinct rule files and loads one physical file once", async () => {
    const home = path.resolve(path.join(os.tmpdir(), "qling-case-home"));
    const workspaceDir = path.resolve(path.join(os.tmpdir(), "qling-case-ws"));
    const stateDir = path.join(home, ".qling");
    const entries = new Map();
    const physical = new Map();
    const add = (file, content, canonical = file) => {
      const key = path.resolve(file);
      entries.set(key, content);
      physical.set(key, path.resolve(canonical));
    };
    add(path.join(stateDir, "memory", "user-rules.md"), "user-rule-body");
    add(path.join(home, "AGENTS.md"), "home-agents-body");
    add(path.join(home, "CLAUDE.md"), "home-claude-body");
    add(path.join(workspaceDir, "AGENTS.md"), "workspace-agents-body");
    add(path.join(workspaceDir, "Agents.md"), "workspace-agents-body");
    const claude = path.join(workspaceDir, "CLAUDE.md");
    add(claude, "workspace-claude-once");
    add(path.join(workspaceDir, "Claude.md"), "workspace-claude-once", claude);
    const fileSystem = {
      async stat(filePath) {
        if (!entries.has(path.resolve(filePath))) {
          const error = new Error("ENOENT");
          error.code = "ENOENT";
          throw error;
        }
        return { isFile: () => true };
      },
      async readFile(filePath) {
        const content = entries.get(path.resolve(filePath));
        if (content === undefined) throw new Error("ENOENT");
        return content;
      },
      async realpath(filePath) {
        const key = path.resolve(filePath);
        if (!physical.has(key)) throw new Error("ENOENT");
        return physical.get(key);
      },
    };
    const files = await loadMandatoryRuleFiles({
      workspaceDir,
      stateDir,
      homeDir: home,
      fileSystem,
    });
    const contents = files.map((file) => file.content);
    assert.ok(contents.includes("user-rule-body"));
    assert.ok(contents.includes("home-agents-body"), "missing Agents.md must not hide AGENTS.md");
    assert.ok(contents.includes("home-claude-body"), "missing Claude.md must not hide CLAUDE.md");
    assert.equal(contents.filter((content) => content === "workspace-agents-body").length, 1);
    assert.equal(contents.filter((content) => content === "workspace-claude-once").length, 1);
    assert.equal(contents.filter((content) => content === "home-agents-body").length, 1);
  });
});
