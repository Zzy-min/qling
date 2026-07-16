import test from "node:test";
import assert from "node:assert/strict";
import {
  curateSkillCatalog,
  isNonExecutableSkill,
  shouldSkipSkillDirName,
} from "../../dist/skills/skill-catalog.js";

test("skip archive and template dir names", () => {
  assert.equal(shouldSkipSkillDirName("templates"), true);
  assert.equal(shouldSkipSkillDirName("archive"), true);
  assert.equal(shouldSkipSkillDirName("lifecycle-build"), false);
});

test("placeholder and template skills are non-executable", () => {
  assert.equal(
    isNonExecutableSkill({
      name: "my-skill",
      description: "一句话说明该 skill 何时被加载",
      tags: ["template"],
      path: "/x/templates/SKILL.md",
      triggers: [],
    }),
    true
  );
  assert.equal(
    isNonExecutableSkill({
      name: "opencli",
      description: "正确调用本机 opencli",
      tags: [],
      path: "/skills/opencli/SKILL.md",
      triggers: [],
    }),
    false
  );
});

test("curateSkillCatalog filters and dedupes", () => {
  const { usable, archived } = curateSkillCatalog([
    {
      name: "opencli",
      description: "opencli 本机",
      tags: [],
      path: "/pkg/opencli/SKILL.md",
      triggers: [],
    },
    {
      name: "opencli",
      description: "duplicate hermes",
      tags: [],
      path: "/hermes/opencli/SKILL.md",
      triggers: [],
    },
    {
      name: "my-skill",
      description: "一句话说明",
      tags: ["template"],
      path: "/templates/SKILL.md",
      triggers: [],
    },
  ]);
  assert.equal(usable.length, 1);
  assert.equal(usable[0].name, "opencli");
  assert.ok(archived.length >= 2);
});
