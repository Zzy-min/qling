// ============================================================
// 轻灵 - s05 Skill 加载
// 动态加载 .md 知识文件，通过 tool_result 注入上下文
// 格言：用到什么知识，临时加载什么知识，不塞 system prompt
// ============================================================

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve, join } from "path";
import { ToolDefinition, ToolResult } from "../types.js";

// Skill 查找路径
// 支持两种格式：
//   name="foo"        → 搜索 skills/foo.md
//   name="@scope/foo" → 搜索 skills/scopes/scope/foo.md
const SKILL_DIRS = [
  resolve(process.cwd(), "skills"),
  resolve(process.cwd(), ".qingling/skills"),
  join(process.env.HERMES_HOME ?? "", "skills"),
];

function resolveSkillPath(name: string): string | null {
  // @scope/name 格式
  const scoped = name.match(/^@([^/]+)\/(.+)$/);
  if (scoped) {
    const [, scope, base] = scoped;
    for (const dir of SKILL_DIRS) {
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
  for (const dir of SKILL_DIRS) {
    const p = join(dir, `${name}.md`);
    if (existsSync(p)) return p;
    // name/index.md
    const p2 = join(dir, name, "index.md");
    if (existsSync(p2)) return p2;
  }
  return null;
}

export const skillTool: ToolDefinition = {
  name: "skill",
  description:
    "Dynamically load a skill/knowledge file (.md). Use when encountering unfamiliar tools, APIs, or frameworks. Returns file content as context — does not modify system prompt.",
  longDescription: `动态加载技能/知识文件（SKILL.md），内容通过 tool_result 注入上下文。

**核心原则**: "用到什么知识，临时加载什么知识，不塞 system prompt"

**查找路径**:
- skills/{name}.md
- skills/{category}/{name}.md
- @scope/name → scopes/{scope}/{name}.md

**使用场景**:
- 调用 docker 但不熟悉命令 → skill(name="docker")
- 调用 Kubernetes API → skill(name="k8s-debug")
- 调用某个第三方库 → skill(name="stripe-api")
- 调试特定错误模式 → skill(name="python-async")

**返回内容**:
- 文件的 markdown body（不含 frontmatter）
- 包含使用说明、命令示例、已知陷阱`,
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Skill name without .md extension (e.g. 'docker', '@k8s/debug')",
      },
    },
    required: ["name"],
  },
  paramSchema: {
    name: {
      type: "string",
      description: "技能名称（不含 .md 后缀）。支持普通格式和 @scope/name 格式。",
      minLength: 1,
      pattern: "^[a-zA-Z0-9_/-]+$",
    },
  },
  examples: [
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

export async function runSkill(args: { name: string }): Promise<ToolResult> {
  const skillName = args.name.trim();
  const filePath = resolveSkillPath(skillName);

  if (!filePath) {
    return {
      tool_call_id: "",
      output: `⚠️ 未找到技能: ${skillName}`,
      is_error: true,
    };
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
    return {
      tool_call_id: "",
      output: `📖 技能: ${skillName}\n\n${body}`,
    };
  } catch (err) {
    return {
      tool_call_id: "",
      output: `⚠️ 读取技能文件出错: ${(err as Error).message}`,
      is_error: true,
    };
  }
}
