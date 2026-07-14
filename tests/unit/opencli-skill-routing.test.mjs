import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getSkillDirs, runSkill } from "../../dist/tools/skill.js";
import { listSkills, parseFrontmatter, clearSkillCache } from "../../dist/skills/registry.js";
import {
  buildRestrictionsSection,
  buildWorkflowSection,
  buildToneSection,
} from "../../dist/pipeline/sections.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const opencliSkillPath = join(repoRoot, "skills", "opencli", "SKILL.md");

test("opencli skill file exists with routing-rich frontmatter", () => {
  assert.equal(existsSync(opencliSkillPath), true);
  const raw = readFileSync(opencliSkillPath, "utf8");
  const meta = parseFrontmatter(raw, opencliSkillPath);
  assert.equal(meta.name, "opencli");
  assert.match(meta.description, /抖音|douyin|opencli/i);
  assert.match(meta.description, /url_fetch|tiktok/i);
  assert.ok(meta.tags.some((t) => /douyin|opencli/i.test(t)));
  assert.match(raw, /opencli douyin/);
  assert.match(raw, /TikTok|tiktok/);
  assert.match(raw, /xiaohongshu/);
  assert.match(raw, /xsec_token/);
  assert.match(raw, /-f json/);
  assert.doesNotMatch(raw, /仅支持 TikTok，不支持抖音/);
});

test("opencli frontmatter parses identically after a CRLF checkout", () => {
  const raw = readFileSync(opencliSkillPath, "utf8");
  const crlfRaw = raw.replace(/\r?\n/g, "\r\n");
  const meta = parseFrontmatter(crlfRaw, opencliSkillPath);

  assert.equal(meta.name, "opencli");
  assert.match(meta.description, /抖音|douyin|opencli/i);
  assert.ok(meta.tags.some((tag) => /douyin|opencli/i.test(tag)));
});

test("getSkillDirs includes package-bundled skills directory", () => {
  const dirs = getSkillDirs();
  assert.ok(dirs.length >= 2, `expected multiple skill dirs, got ${dirs.join(", ")}`);
  const packageSkills = join(repoRoot, "skills");
  assert.ok(
    dirs.some((d) => d.replace(/\\/g, "/").endsWith("/skills") || d === packageSkills),
    `package skills not in ${dirs.join(" | ")}`
  );
});

test("listSkills discovers opencli from package skills path", async () => {
  clearSkillCache();
  const skills = await listSkills([join(repoRoot, "skills")]);
  const opencli = skills.find((s) => s.name === "opencli");
  assert.ok(opencli, `opencli not found in ${skills.map((s) => s.name).join(", ")}`);
  assert.match(opencli.description, /opencli|抖音/i);
});

test("runSkill loads opencli body with decision tree", async () => {
  clearSkillCache();
  const prev = process.cwd();
  try {
    process.chdir(repoRoot);
    const result = await runSkill({ name: "opencli" });
    assert.notEqual(result.is_error, true, result.output);
    assert.match(result.output, /硬规则|决策树|opencli douyin/i);
    assert.match(result.output, /url_fetch/);
  } finally {
    process.chdir(prev);
    clearSkillCache();
  }
});

test("restrictions section routes social platforms to opencli skill", () => {
  const section = buildRestrictionsSection();
  assert.match(section.content, /skill name="opencli"/);
  assert.match(section.content, /opencli douyin/);
  assert.match(section.content, /xiaohongshu|xsec_token/);
  assert.match(section.content, /url_fetch/);
  assert.match(section.content, /TikTok|tiktok/i);
  assert.match(section.content, /关联分析|外部工具/);
  assert.match(section.content, /实事求是|失败/);
});

test("workflow section encodes three task execution rules", () => {
  const section = buildWorkflowSection();
  assert.match(section.content, /任务执行三条基本规则/);
  assert.match(section.content, /关联分析|工具是否匹配/);
  assert.match(section.content, /正确流程|可复现/);
  assert.match(section.content, /未完成|失败|实事求是|禁止把挑战页/);
});

test("tone section requires honest success and failure reporting", () => {
  const section = buildToneSection();
  assert.match(section.content, /正确流程/);
  assert.match(section.content, /失败|不粉饰/);
});
