// ============================================================
// 轻灵 - s05 Skill 加载
// 动态加载 .md 知识文件，通过 tool_result 注入上下文
// 格言：用到什么知识，临时加载什么知识，不塞 system prompt
// ============================================================

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { ToolDefinition, ToolResult } from "../types.js";
import { toolError, toolSuccess } from "./error-utils.js";
import { listSkills, searchSkills, parseSkillFile } from "../skills/registry.js";

/** 包根目录（dist/tools/skill.js → 仓库或 npm 包根，含 skills/） */
export function getPackageRootForSkills(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/tools → ../.. = package root
  return resolve(here, "..", "..");
}

// Skill 查找路径
// 支持两种格式：
//   name="foo"        → 搜索 skills/foo.md
//   name="@scope/foo" → 搜索 skills/scopes/scope/foo.md
export function getSkillDirs(): string[] {
  const dirs: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    const abs = resolve(p);
    if (seen.has(abs)) return;
    seen.add(abs);
    dirs.push(abs);
  };

  // 1) 随包发布的 skills（全局 npm 安装仍可用）
  add(join(getPackageRootForSkills(), "skills"));
  // 2) 用户全局
  add(join(homedir(), ".qling", "skills"));
  // 3) 当前工作区
  add(resolve(process.cwd(), "skills"));
  add(resolve(process.cwd(), ".qling", "skills"));
  // 4) 可选 Hermes 兼容路径
  const hermesHome = process.env.HERMES_HOME;
  if (hermesHome && hermesHome.trim()) {
    add(join(hermesHome.trim(), "skills"));
  }
  return dirs;
}

function resolveSkillPath(name: string): string | null {
  const dirs = getSkillDirs();

  // @scope/name 格式
  const scoped = name.match(/^@([^/]+)\/(.+)$/);
  if (scoped) {
    const [, scope, base] = scoped;
    for (const dir of dirs) {
      // scopes/scope/name.md
      const p = join(dir, "scopes", scope, `${base}.md`);
      if (existsSync(p)) return p;
      // scopes/scope/name/index.md
      const p2 = join(dir, "scopes", scope, base, "index.md");
      if (existsSync(p2)) return p2;
    }
    return null;
  }

  // 普通 name 格式
  for (const dir of dirs) {
    const p = join(dir, `${name}.md`);
    if (existsSync(p)) return p;
    // name/index.md
    const p2 = join(dir, name, "index.md");
    if (existsSync(p2)) return p2;
    const p3 = join(dir, name, "SKILL.md");
    if (existsSync(p3)) return p3;
  }
  return null;
}

export const skillTool: ToolDefinition = {
  name: "skill",
  description:
    "Load a skill knowledge file. Use for unfamiliar tools/APIs and ALWAYS before opencli/social platforms (Douyin, Xiaohongshu, Weibo, Bilibili, TikTok, Twitter). Actions: list | search query= | name=opencli.",
  longDescription: `动态加载技能/知识文件（SKILL.md），内容通过 tool_result 注入上下文。

**核心原则**: "用到什么知识，临时加载什么知识，不塞 system prompt"

**三种操作**:
- skill list — 列出所有可用技能
- skill search query="opencli" — 搜索技能
- skill name="opencli" — 加载 opencli 调用手册（抖音/小红书等）

**查找路径**:
- 包内 skills/（npm 全局安装可用）
- ~/.qling/skills/
- 工作区 skills/ 与 .qling/skills/
- @scope/name → scopes/{scope}/{name}.md

**使用场景**:
- 抖音/小红书/微博/B站/TikTok/推特 → skill(name="opencli") 再用 bash 跑 opencli
- 调用 docker 但不熟悉命令 → skill(name="docker")
- 不确定有哪些技能 → skill list

**返回内容**:
- 文件的 markdown body（不含 frontmatter）
- 包含使用说明、命令示例、已知陷阱`,
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Skill name without .md extension (e.g. 'docker', '@k8s/debug'), or 'list' to list all skills",
      },
      query: {
        type: "string",
        description: "Search query for finding skills by name/description/tags (used with search action)",
      },
    },
    required: [],
  },
  paramSchema: {
    name: {
      type: "string",
      description: "技能名称（不含 .md 后缀）。支持普通格式和 @scope/name 格式。传 'list' 列出所有技能。",
      minLength: 1,
      pattern: "^[a-zA-Z0-9_/@-]+$",
    },
    query: {
      type: "string",
      description: "搜索关键词，按名称/描述/标签模糊匹配。",
    },
  },
  examples: [
    'skill list',
    'skill search query="docker"',
    'skill name="docker"',
    'skill name="python-async"',
    'skill name="@k8s/debug"',
  ],
  seeAlso: ["bash", "todo"],
  scenes: ["knowledge", "planning"],
  priority: 6,
  readOnly: true,
  destructive: false,
  concurrencySafe: true,
  effortHint: "minimal",
};

export async function runSkill(args: { name?: string; query?: string }): Promise<ToolResult> {
  const name = String(args.name ?? "").trim();
  const query = String(args.query ?? "").trim();

  // list mode
  if (name === "list") {
    const dirs = getSkillDirs();
    const skills = await listSkills(dirs);
    if (skills.length === 0) {
      return toolSuccess("No skills found. Create .md files in skills/ directory to add skills.");
    }
    const lines = skills.map((s) => {
      const tags = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : "";
      return `- ${s.name}: ${s.description || "(no description)"}${tags}`;
    });
    return toolSuccess(`Available skills (${skills.length}):\n${lines.join("\n")}`);
  }

  // search mode
  if (query) {
    const dirs = getSkillDirs();
    const results = await searchSkills(query, dirs);
    if (results.length === 0) {
      return toolSuccess(`No skills matching "${query}".`);
    }
    const lines = results.map((s) => {
      const tags = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : "";
      return `- ${s.name}: ${s.description || "(no description)"}${tags}`;
    });
    return toolSuccess(`Skills matching "${query}" (${results.length}):\n${lines.join("\n")}`);
  }

  // load mode
  if (!name) {
    return toolError("SKILL_MISSING_NAME", "name is required (or use 'list' to list skills)");
  }

  const filePath = resolveSkillPath(name);
  if (!filePath) {
    const dirs = getSkillDirs();
    const available = await listSkills(dirs);
    const hint = available.length > 0
      ? `\nAvailable skills: ${available.map((s) => s.name).join(", ")}`
      : "\nNo skills found. Create .md files in skills/ directory.";
    return toolError("SKILL_NOT_FOUND", `skill not found: ${name}${hint}`);
  }

  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const startIdx = lines.findIndex((l) => l.trim() === "---");
    const endIdx = startIdx >= 0 ? lines.findIndex((l, i) => i > startIdx && l.trim() === "---") : -1;
    const body =
      startIdx >= 0 && endIdx >= 0
        ? lines.slice(endIdx + 1).join("\n").trim()
        : content;
    return toolSuccess(`📖 Skill: ${name}\n\n${body}`);
  } catch (err) {
    return toolError("SKILL_READ_FAILED", `failed to read skill: ${(err as Error).message}`);
  }
}
