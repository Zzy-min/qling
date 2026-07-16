import os from "node:os";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import YAML from "yaml";
import {
  ROLE_DEFINITIONS,
  SUBAGENT_ROLES,
  type RoleDefinition,
  type SubAgentRole,
} from "./roles.js";

export interface LoadedRoleDefinition extends Omit<RoleDefinition, "id"> {
  id: string;
  baseRole: SubAgentRole;
  prompt?: string;
  source: "builtin" | "user" | "workspace";
  path?: string;
}

interface RoleManifest {
  id?: string;
  title?: string;
  description?: string;
  base_role?: SubAgentRole;
  allowed_tools?: string[];
  prompt?: string;
}

function builtinCatalog(): Map<string, LoadedRoleDefinition> {
  const catalog = new Map<string, LoadedRoleDefinition>();
  for (const id of SUBAGENT_ROLES) {
    const role = ROLE_DEFINITIONS[id];
    catalog.set(id, { ...role, id, baseRole: id, source: "builtin" });
  }
  return catalog;
}

function parseMarkdown(raw: string, fallbackId: string): RoleManifest {
  if (!raw.startsWith("---")) return { id: fallbackId, prompt: raw.trim() };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { id: fallbackId, prompt: raw.trim() };
  const meta = YAML.parse(raw.slice(3, end)) as RoleManifest;
  return { ...meta, id: meta.id ?? fallbackId, prompt: raw.slice(end + 4).trim() };
}

async function loadDirectory(
  catalog: Map<string, LoadedRoleDefinition>,
  directory: string,
  source: "user" | "workspace"
): Promise<void> {
  let files: string[];
  try {
    files = await readdir(directory);
  } catch {
    return;
  }
  for (const file of files.sort()) {
    if (!file.endsWith(".json") && !file.endsWith(".md")) continue;
    const filePath = path.join(directory, file);
    try {
      const raw = await readFile(filePath, "utf8");
      const fallbackId = path.basename(file, path.extname(file));
      const manifest = file.endsWith(".json")
        ? (JSON.parse(raw) as RoleManifest)
        : parseMarkdown(raw, fallbackId);
      const id = String(manifest.id ?? fallbackId).trim().toLowerCase();
      const baseRole = manifest.base_role ?? "explore";
      if (!id || !SUBAGENT_ROLES.includes(baseRole)) continue;
      const base = ROLE_DEFINITIONS[baseRole];
      const allowed = new Set(base.allowedTools);
      const requested = Array.isArray(manifest.allowed_tools)
        ? manifest.allowed_tools.map(String).filter((tool) => allowed.has(tool))
        : [...base.allowedTools];
      catalog.set(id, {
        id,
        baseRole,
        title: String(manifest.title ?? id),
        description: String(manifest.description ?? `${source} role based on ${baseRole}`),
        allowedTools: requested,
        canWrite: baseRole === "implement" && requested.some((tool) => tool === "write" || tool === "patch"),
        prompt: manifest.prompt?.trim() || undefined,
        source,
        path: filePath,
      });
    } catch {
      // Invalid role files are ignored and never become callable.
    }
  }
}

export async function loadRoleCatalog(options: {
  workspaceDir?: string;
  stateDir?: string;
  homeDir?: string;
} = {}): Promise<Map<string, LoadedRoleDefinition>> {
  const catalog = builtinCatalog();
  const home = options.homeDir ?? os.homedir();
  const state = options.stateDir ?? path.join(home, ".qling");
  const workspace = options.workspaceDir ?? process.cwd();
  // Later directories override earlier ones: workspace > user > builtin.
  await loadDirectory(catalog, path.join(home, ".claude", "agents"), "user");
  await loadDirectory(catalog, path.join(state, "agents"), "user");
  await loadDirectory(catalog, path.join(workspace, ".claude", "agents"), "workspace");
  await loadDirectory(catalog, path.join(workspace, ".qling", "agents"), "workspace");
  return catalog;
}

export function formatLoadedRoles(catalog: Map<string, LoadedRoleDefinition>): string {
  const lines = ["🎭 【子代理角色】subtask role=…", ""];
  for (const role of [...catalog.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`- ${role.id}（${role.title}） [${role.source}]`);
    lines.push(`  ${role.description}`);
    lines.push(`  基础角色: ${role.baseRole} · 可写: ${role.canWrite ? "是" : "否"}`);
  }
  lines.push("", "可见角色均可调用；工作区定义覆盖用户定义，用户定义覆盖内置定义。");
  return lines.join("\n");
}
