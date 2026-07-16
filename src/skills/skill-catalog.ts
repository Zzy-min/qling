// ============================================================
// 技能目录整理：去模板 / 归档 / 占位，去重后供 /skill 切换器
// ============================================================

import type { SkillMeta } from "../types.js";

/** 不扫描的目录名（归档、模板、示例） */
export const SKILL_SKIP_DIR_NAMES = new Set([
  "templates",
  "template",
  "archive",
  "_archive",
  "archived",
  "examples",
  "example",
  ".git",
  "node_modules",
  "__pycache__",
]);

const PLACEHOLDER_DESC =
  /一句话说明|何时被加载|TODO|placeholder|your skill|example skill/i;

const PLACEHOLDER_NAMES = new Set([
  "my-skill",
  "example",
  "example-skill",
  "template",
  "skill-template",
]);

export function shouldSkipSkillDirName(name: string): boolean {
  return SKILL_SKIP_DIR_NAMES.has(String(name ?? "").trim().toLowerCase());
}

/** 是否为不可执行的占位 / 模板 skill（应归档，不进切换器） */
export function isNonExecutableSkill(meta: SkillMeta): boolean {
  const name = String(meta.name ?? "").trim().toLowerCase();
  if (!name) return true;
  if (PLACEHOLDER_NAMES.has(name)) return true;

  const tags = (meta.tags ?? []).map((t) => String(t).toLowerCase());
  if (tags.includes("template") || tags.includes("example") || tags.includes("placeholder")) {
    return true;
  }

  const desc = String(meta.description ?? "").trim();
  if (!desc) return true;
  if (PLACEHOLDER_DESC.test(desc)) return true;

  const path = String(meta.path ?? "").replace(/\\/g, "/").toLowerCase();
  if (
    path.includes("/templates/") ||
    path.includes("/archive/") ||
    path.includes("/_archive/") ||
    path.includes("/examples/")
  ) {
    return true;
  }

  return false;
}

/**
 * 整理 skill 列表：过滤不可执行 → 按 name 去重（先出现的优先，包内 skills 通常在前）
 */
export function curateSkillCatalog(skills: SkillMeta[]): {
  usable: SkillMeta[];
  archived: SkillMeta[];
} {
  const archived: SkillMeta[] = [];
  const usable: SkillMeta[] = [];
  const seen = new Set<string>();

  for (const s of skills) {
    if (isNonExecutableSkill(s)) {
      archived.push(s);
      continue;
    }
    const key = String(s.name ?? "")
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) {
      // 重名：视为被前序源覆盖，记入 archived 侧仅作统计
      if (key && seen.has(key)) archived.push(s);
      continue;
    }
    seen.add(key);
    usable.push(s);
  }

  usable.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  return { usable, archived };
}
