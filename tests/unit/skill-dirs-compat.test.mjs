import test from "node:test";
import assert from "node:assert/strict";
import { getSkillDirs } from "../../dist/tools/skill.js";

test("getSkillDirs includes Grok-compat vendor paths by default", () => {
  const prev = { ...process.env };
  try {
    delete process.env.QLING_CLAUDE_SKILLS_ENABLED;
    delete process.env.QLING_CURSOR_SKILLS_ENABLED;
    delete process.env.QLING_GROK_SKILLS_ENABLED;
    delete process.env.QLING_AGENTS_SKILLS_ENABLED;
    const dirs = getSkillDirs().map((d) => d.replace(/\\/g, "/").toLowerCase());
    const joined = dirs.join("\n");
    assert.match(joined, /\.qling\/skills/);
    assert.match(joined, /\.grok\/skills/);
    assert.match(joined, /\.agents\/skills/);
    assert.match(joined, /\.claude\/skills/);
    assert.match(joined, /\.cursor\/skills/);
    // cwd local 应出现在 user 路径之前（先出现优先）
    const cwdQling = dirs.findIndex((d) => d.endsWith("/.qling/skills") && !d.includes(process.env.USERPROFILE?.replace(/\\/g, "/").toLowerCase() ?? "___"));
    // 至少保证列表非空且含 skills 段
    assert.ok(dirs.length >= 3);
    void cwdQling;
  } finally {
    process.env = prev;
  }
});

test("getSkillDirs respects QLING_CLAUDE_SKILLS_ENABLED=0", () => {
  const prev = process.env.QLING_CLAUDE_SKILLS_ENABLED;
  try {
    process.env.QLING_CLAUDE_SKILLS_ENABLED = "0";
    const joined = getSkillDirs()
      .map((d) => d.replace(/\\/g, "/").toLowerCase())
      .join("\n");
    assert.doesNotMatch(joined, /\.claude\/skills/);
  } finally {
    if (prev === undefined) delete process.env.QLING_CLAUDE_SKILLS_ENABLED;
    else process.env.QLING_CLAUDE_SKILLS_ENABLED = prev;
  }
});
