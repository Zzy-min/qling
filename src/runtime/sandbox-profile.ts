// ============================================================
// G3.4 — Sandbox profiles（软路径策略；Windows 友好）
// ============================================================

import * as path from "path";
import {
  getRuntimeRootsFromEnv,
  isPathAllowedForWrite,
  isWithinAllowedRoots,
  resolveEffectiveWorkspace,
  resolveWriteSandboxMode,
  type RuntimeRoots,
  type WriteSandboxMode,
} from "../runtime-paths.js";

/**
 * 产品面 profile：
 * - workspace: 写仅工作区（默认）
 * - read-only: 禁止一切写工具路径
 * - strict: 工作区写 + bash cwd 必须在工作区 + 敏感文件始终拦
 * - roots: 工作区 + state + cache
 * - off: 关闭路径沙箱
 */
export type SandboxProfile = "workspace" | "read-only" | "strict" | "roots" | "off";

const PROFILE_ALIASES: Record<string, SandboxProfile> = {
  workspace: "workspace",
  ws: "workspace",
  default: "workspace",
  "read-only": "read-only",
  readonly: "read-only",
  ro: "read-only",
  read_only: "read-only",
  strict: "strict",
  hard: "strict",
  roots: "roots",
  all: "roots",
  legacy: "roots",
  off: "off",
  false: "off",
  "0": "off",
  none: "off",
};

export function parseSandboxProfile(raw: string | null | undefined): SandboxProfile | null {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!t) return null;
  return PROFILE_ALIASES[t] ?? null;
}

/**
 * 解析当前 profile。
 * 优先 QLING_SANDBOX_PROFILE；否则映射 QLING_WRITE_SANDBOX。
 */
export function resolveSandboxProfile(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): SandboxProfile {
  const fromProfile = parseSandboxProfile(env.QLING_SANDBOX_PROFILE);
  if (fromProfile) return fromProfile;

  const writeMode = resolveWriteSandboxMode(env);
  if (writeMode === "off") return "off";
  if (writeMode === "roots") return "roots";
  return "workspace";
}

export function setSandboxProfile(
  profile: SandboxProfile,
  env: NodeJS.ProcessEnv = process.env
): void {
  env.QLING_SANDBOX_PROFILE = profile;
  // 兼容旧写沙箱 env
  if (profile === "workspace" || profile === "strict" || profile === "read-only") {
    env.QLING_WRITE_SANDBOX = "workspace";
  } else if (profile === "roots") {
    env.QLING_WRITE_SANDBOX = "roots";
  } else {
    env.QLING_WRITE_SANDBOX = "off";
  }
}

export function profileToWriteSandboxMode(profile: SandboxProfile): WriteSandboxMode {
  if (profile === "off") return "off";
  if (profile === "roots") return "roots";
  // workspace / read-only / strict → 路径层仍按 workspace（read-only 另拦）
  return "workspace";
}

export function isWriteBlockedByProfile(profile: SandboxProfile): boolean {
  return profile === "read-only";
}

export function isSensitiveAlwaysBlocked(profile: SandboxProfile): boolean {
  return profile === "strict";
}

export function isPathAllowedUnderProfile(
  absPath: string,
  profile: SandboxProfile = resolveSandboxProfile(),
  roots: RuntimeRoots = getRuntimeRootsFromEnv()
): boolean {
  if (profile === "read-only") return false;
  if (profile === "off") return true;
  const writeMode = profileToWriteSandboxMode(profile);
  return isPathAllowedForWrite(absPath, roots, writeMode);
}

/**
 * bash cwd 是否允许。
 * - off: 任意
 * - roots: allowed roots
 * - workspace / read-only: 有效工作区（及 roots 内对 bash 可读）
 * - strict: **必须**在有效工作区内
 */
export function isBashCwdAllowed(
  absCwd: string,
  profile: SandboxProfile = resolveSandboxProfile(),
  roots: RuntimeRoots = getRuntimeRootsFromEnv()
): boolean {
  const target = path.resolve(absCwd);
  if (profile === "off") return true;
  if (profile === "strict") {
    const ws = resolveEffectiveWorkspace(roots);
    return isSubPath(target, ws);
  }
  if (profile === "roots") {
    return isWithinAllowedRoots(target, roots);
  }
  // workspace / read-only: 工作区或（无显式 workspace 时）cwd 根
  const ws = resolveEffectiveWorkspace(roots);
  if (isSubPath(target, ws)) return true;
  // 宽松：若未设置 QLING_WORKSPACE_DIR，允许 process.cwd 子树已覆盖；
  // 另允许 state/cache 以便工具缓存目录执行
  return isWithinAllowedRoots(target, roots);
}

function isSubPath(target: string, base: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function sandboxProfileSummary(profile: SandboxProfile = resolveSandboxProfile()): string {
  switch (profile) {
    case "read-only":
      return "只读：禁止 write/patch 路径；bash 可用";
    case "strict":
      return "严格：写与 bash cwd 均限工作区；敏感文件始终拦截";
    case "roots":
      return "roots：写允许 workspace+state+cache";
    case "off":
      return "关闭路径沙箱（仍可经权限/敏感检查）";
    default:
      return "工作区：写仅限 workspace（默认）";
  }
}

export function formatSandboxStatusLines(
  profile: SandboxProfile = resolveSandboxProfile(),
  roots: RuntimeRoots = getRuntimeRootsFromEnv()
): string[] {
  return [
    "",
    "🛡️ 【Sandbox Profile】",
    "-----------------------------------------",
    `Profile   : ${profile}`,
    `Summary   : ${sandboxProfileSummary(profile)}`,
    `Workspace : ${resolveEffectiveWorkspace(roots)}`,
    `Env       : QLING_SANDBOX_PROFILE=${process.env.QLING_SANDBOX_PROFILE ?? "-"}`,
    `Compat    : QLING_WRITE_SANDBOX=${process.env.QLING_WRITE_SANDBOX ?? "-"}`,
    "切换      : /sandbox workspace|read-only|strict|roots|off",
    "-----------------------------------------",
    "",
  ];
}
