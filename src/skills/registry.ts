// ============================================================
// 轻灵 - 技能注册表
// 扫描目录、解析 YAML frontmatter、mtime 缓存
// ============================================================

import { readdir, readFile, stat } from "fs/promises";
import { join, basename, extname } from "path";
import YAML from "yaml";
import type { SkillMeta } from "./types.js";

interface CacheEntry {
  meta: SkillMeta;
  mtimeMs: number;
}

const cache = new Map<string, CacheEntry>();

export async function scanSkillDirs(dirs: string[]): Promise<SkillMeta[]> {
  const results: SkillMeta[] = [];
  for (const dir of dirs) {
    try {
      const dirStat = await stat(dir);
      if (!dirStat.isDirectory()) continue;
    } catch {
      continue;
    }
    await walkSkillDir(dir, results);
  }
  return results;
}

export async function listSkills(dirs: string[]): Promise<SkillMeta[]> {
  return scanSkillDirs(dirs);
}

export async function searchSkills(query: string, dirs: string[]): Promise<SkillMeta[]> {
  const all = await scanSkillDirs(dirs);
  const q = query.toLowerCase();
  return all.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
  );
}

async function walkSkillDir(dir: string, results: SkillMeta[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const { shouldSkipSkillDirName } = await import("./skill-catalog.js");

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // 跳过 templates / archive / examples 等归档目录
      if (shouldSkipSkillDirName(entry.name)) continue;
      // Check for index.md inside directory
      const indexPath = join(fullPath, "index.md");
      const meta = await parseSkillFile(indexPath);
      if (meta) results.push(meta);
      const skillPath = join(fullPath, "SKILL.md");
      const skillMeta = await parseSkillFile(skillPath);
      if (skillMeta) results.push(skillMeta);
      continue;
    }

    if (entry.isFile() && extname(entry.name) === ".md") {
      const meta = await parseSkillFile(fullPath);
      if (meta) results.push(meta);
    }
  }
}

export async function parseSkillFile(filePath: string): Promise<SkillMeta | null> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return null;

    // Check cache
    const cached = cache.get(filePath);
    if (cached && cached.mtimeMs === fileStat.mtimeMs) {
      return cached.meta;
    }

    const raw = await readFile(filePath, "utf-8");
    const meta = parseFrontmatter(raw, filePath);

    // Update cache
    cache.set(filePath, { meta, mtimeMs: fileStat.mtimeMs });
    return meta;
  } catch {
    return null;
  }
}

export function parseFrontmatter(raw: string, filePath: string): SkillMeta {
  const fileBaseName = basename(filePath, ".md");
  const fallbackName = fileBaseName.toLowerCase() === "skill" || fileBaseName.toLowerCase() === "index"
    ? basename(join(filePath, ".."))
    : fileBaseName;
  const fallback: SkillMeta = {
    name: fallbackName,
    description: "",
    tags: [],
    triggers: [],
    path: filePath,
  };

  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const firstIdx = lines.findIndex((l) => l.trim() === "---");
  if (firstIdx < 0) return fallback;

  const secondIdx = lines.findIndex((i, idx) => idx > firstIdx && i.trim() === "---");
  if (secondIdx < 0) return fallback;

  const yamlBlock = lines.slice(firstIdx + 1, secondIdx).join("\n");
  try {
    const parsed = YAML.parse(yamlBlock) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return fallback;

    const triggersRaw = parsed.triggers ?? parsed.trigger;
    let triggers: string[] = [];
    if (Array.isArray(triggersRaw)) {
      triggers = triggersRaw.map(String).filter(Boolean);
    } else if (typeof triggersRaw === "string" && triggersRaw.trim()) {
      triggers = triggersRaw.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    }

    return {
      name: typeof parsed.name === "string" && parsed.name ? parsed.name : fallbackName,
      description: typeof parsed.description === "string" ? parsed.description : "",
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
      triggers,
      path: filePath,
    };
  } catch {
    return fallback;
  }
}

export function clearSkillCache(): void {
  cache.clear();
}
