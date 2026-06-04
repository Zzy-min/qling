// ============================================================
// 技能系统单元测试
// ============================================================

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseFrontmatter, scanSkillDirs, searchSkills, clearSkillCache } from "../../dist/skills/registry.js";
import { runSkill } from "../../dist/tools/skill.js";

async function withSkillDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "qling-skill-"));
  const prevCwd = process.cwd();
  try {
    process.chdir(dir);
    await mkdir(join(dir, "skills"), { recursive: true });
    await fn(dir);
  } finally {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
    clearSkillCache();
  }
}

describe("parseFrontmatter", () => {
  it("parses normal YAML frontmatter", () => {
    const raw = "---\nname: docker\ndescription: Docker commands\ntags: [devops, container]\n---\n\nBody content";
    const meta = parseFrontmatter(raw, "/test/docker.md");
    assert.equal(meta.name, "docker");
    assert.equal(meta.description, "Docker commands");
    assert.deepEqual(meta.tags, ["devops", "container"]);
    assert.equal(meta.path, "/test/docker.md");
  });

  it("uses filename as fallback name when frontmatter has no name", () => {
    const raw = "---\ndescription: Some desc\n---\n\nBody";
    const meta = parseFrontmatter(raw, "/test/myskill.md");
    assert.equal(meta.name, "myskill");
    assert.equal(meta.description, "Some desc");
  });

  it("returns fallback when no frontmatter delimiters", () => {
    const raw = "Just plain markdown content";
    const meta = parseFrontmatter(raw, "/test/plain.md");
    assert.equal(meta.name, "plain");
    assert.equal(meta.description, "");
    assert.deepEqual(meta.tags, []);
  });

  it("returns fallback when YAML is invalid", () => {
    const raw = "---\n: invalid: yaml: [[\n---\n\nBody";
    const meta = parseFrontmatter(raw, "/test/bad.md");
    assert.equal(meta.name, "bad");
    assert.equal(meta.description, "");
  });

  it("handles missing closing delimiter", () => {
    const raw = "---\nname: test\nNo closing delimiter here";
    const meta = parseFrontmatter(raw, "/test/incomplete.md");
    assert.equal(meta.name, "incomplete");
  });

  it("defaults tags to empty array when not provided", () => {
    const raw = "---\nname: x\ndescription: y\n---\n\nBody";
    const meta = parseFrontmatter(raw, "/test/x.md");
    assert.deepEqual(meta.tags, []);
  });
});

describe("scanSkillDirs", () => {
  it("discovers .md files in skills directory", async () => {
    await withSkillDir(async (dir) => {
      await writeFile(join(dir, "skills", "docker.md"), "---\nname: docker\ndescription: Docker\n---\n\nContent");
      await writeFile(join(dir, "skills", "git.md"), "---\nname: git\ndescription: Git\n---\n\nContent");

      const skills = await scanSkillDirs([join(dir, "skills")]);
      assert.equal(skills.length, 2);
      const names = skills.map((s) => s.name).sort();
      assert.deepEqual(names, ["docker", "git"]);
    });
  });

  it("discovers index.md inside subdirectories", async () => {
    await withSkillDir(async (dir) => {
      await mkdir(join(dir, "skills", "k8s"), { recursive: true });
      await writeFile(
        join(dir, "skills", "k8s", "index.md"),
        "---\nname: k8s\ndescription: Kubernetes\n---\n\nContent"
      );

      const skills = await scanSkillDirs([join(dir, "skills")]);
      assert.equal(skills.length, 1);
      assert.equal(skills[0].name, "k8s");
    });
  });

  it("returns empty for non-existent directory", async () => {
    const skills = await scanSkillDirs(["/definitely/not/exist"]);
    assert.deepEqual(skills, []);
  });

  it("scans multiple directories", async () => {
    await withSkillDir(async (dir) => {
      const dir1 = join(dir, "skills1");
      const dir2 = join(dir, "skills2");
      await mkdir(dir1, { recursive: true });
      await mkdir(dir2, { recursive: true });
      await writeFile(join(dir1, "a.md"), "---\nname: a\n---\n\nA");
      await writeFile(join(dir2, "b.md"), "---\nname: b\n---\n\nB");

      const skills = await scanSkillDirs([dir1, dir2]);
      assert.equal(skills.length, 2);
      const names = skills.map((s) => s.name).sort();
      assert.deepEqual(names, ["a", "b"]);
    });
  });

  it("ignores non-.md files", async () => {
    await withSkillDir(async (dir) => {
      await writeFile(join(dir, "skills", "readme.txt"), "not a skill");
      await writeFile(join(dir, "skills", "docker.md"), "---\nname: docker\n---\n\nContent");

      const skills = await scanSkillDirs([join(dir, "skills")]);
      assert.equal(skills.length, 1);
      assert.equal(skills[0].name, "docker");
    });
  });
});

describe("searchSkills", () => {
  it("finds skills by name substring", async () => {
    await withSkillDir(async (dir) => {
      await writeFile(join(dir, "skills", "docker.md"), "---\nname: docker\ndescription: Containers\n---\n\nX");
      await writeFile(join(dir, "skills", "git.md"), "---\nname: git\ndescription: VCS\n---\n\nX");

      const results = await searchSkills("dock", [join(dir, "skills")]);
      assert.equal(results.length, 1);
      assert.equal(results[0].name, "docker");
    });
  });

  it("finds skills by description", async () => {
    await withSkillDir(async (dir) => {
      await writeFile(join(dir, "skills", "a.md"), "---\nname: a\ndescription: Kubernetes guide\n---\n\nX");
      await writeFile(join(dir, "skills", "b.md"), "---\nname: b\ndescription: Git tips\n---\n\nX");

      const results = await searchSkills("kubernetes", [join(dir, "skills")]);
      assert.equal(results.length, 1);
      assert.equal(results[0].name, "a");
    });
  });

  it("finds skills by tag", async () => {
    await withSkillDir(async (dir) => {
      await writeFile(join(dir, "skills", "a.md"), "---\nname: a\ntags: [devops, docker]\n---\n\nX");
      await writeFile(join(dir, "skills", "b.md"), "---\nname: b\ntags: [frontend]\n---\n\nX");

      const results = await searchSkills("devops", [join(dir, "skills")]);
      assert.equal(results.length, 1);
      assert.equal(results[0].name, "a");
    });
  });

  it("returns empty for no match", async () => {
    await withSkillDir(async (dir) => {
      await writeFile(join(dir, "skills", "a.md"), "---\nname: a\n---\n\nX");
      const results = await searchSkills("zzzzz", [join(dir, "skills")]);
      assert.deepEqual(results, []);
    });
  });
});

describe("runSkill", () => {
  it("lists skills with 'list'", async () => {
    await withSkillDir(async (dir) => {
      await writeFile(join(dir, "skills", "docker.md"), "---\nname: docker\ndescription: Docker cmds\n---\n\nBody");
      const result = await runSkill({ name: "list" });
      assert.equal(result.is_error, undefined);
      assert.match(result.output, /docker/);
      assert.match(result.output, /Docker cmds/);
    });
  });

  it("searches skills with query param", async () => {
    await withSkillDir(async (dir) => {
      await writeFile(join(dir, "skills", "docker.md"), "---\nname: docker\ndescription: Containers\n---\n\nBody");
      await writeFile(join(dir, "skills", "git.md"), "---\nname: git\ndescription: VCS\n---\n\nBody");
      const result = await runSkill({ query: "container" });
      assert.match(result.output, /docker/);
    });
  });

  it("loads skill content by name", async () => {
    await withSkillDir(async (dir) => {
      await writeFile(join(dir, "skills", "test.md"), "---\nname: test\n---\n\nHello World");
      const result = await runSkill({ name: "test" });
      assert.match(result.output, /Hello World/);
      assert.match(result.output, /📖 Skill: test/);
    });
  });

  it("returns error for non-existent skill", async () => {
    await withSkillDir(async (dir) => {
      const result = await runSkill({ name: "nonexistent" });
      assert.equal(result.is_error, true);
      assert.match(result.output, /SKILL_NOT_FOUND/);
    });
  });

  it("returns error when no name and no query", async () => {
    const result = await runSkill({});
    assert.equal(result.is_error, true);
    assert.match(result.output, /SKILL_MISSING_NAME/);
  });
});
