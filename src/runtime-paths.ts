import * as os from "os";
import * as path from "path";

export interface RuntimeRoots {
  workspaceDir: string | null;
  fileCacheDir: string;
  fileStateDir: string;
}

export type DefaultRootKind = "workspace" | "file_cache" | "file_state";

/** write/patch 沙箱：默认仅工作区 */
export type WriteSandboxMode = "workspace" | "roots" | "off";

const HOME = os.homedir();
const DEFAULT_STATE_DIR = path.join(HOME, ".qling");
const DEFAULT_CACHE_DIR = path.join(DEFAULT_STATE_DIR, "cache");

/** 默认拒绝写入的敏感文件名模式（小写比较） */
const SENSITIVE_BASENAME_EXACT = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  "id_rsa",
  "id_ed25519",
  "credentials.json",
  "service-account.json",
  ".npmrc",
  ".pypirc",
]);

const SENSITIVE_BASENAME_SUFFIXES = [".pem", ".key", ".p12", ".pfx"];

export function getRuntimeRootsFromEnv(env: NodeJS.ProcessEnv = process.env): RuntimeRoots {
  const state = path.resolve(env.QLING_FILE_STATE_DIR ?? DEFAULT_STATE_DIR);
  const cache = path.resolve(env.QLING_FILE_CACHE_DIR ?? path.join(state, "cache"));
  const ws = env.QLING_WORKSPACE_DIR?.trim();

  return {
    workspaceDir: ws ? path.resolve(ws) : null,
    fileCacheDir: cache,
    fileStateDir: state,
  };
}

export function resolveWriteSandboxMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): WriteSandboxMode {
  const raw = String(env.QLING_WRITE_SANDBOX ?? "workspace").trim().toLowerCase();
  if (raw === "off" || raw === "false" || raw === "0" || raw === "none") return "off";
  if (raw === "roots" || raw === "all" || raw === "legacy") return "roots";
  return "workspace";
}

/** 有效工作区：显式 workspace，否则 cwd */
export function resolveEffectiveWorkspace(roots: RuntimeRoots): string {
  return path.resolve(roots.workspaceDir ?? process.cwd());
}

/**
 * 写工具路径是否允许。
 * - workspace: 仅工作区（默认）
 * - roots: workspace + state + cache
 * - off: 不检查
 */
export function isPathAllowedForWrite(
  absPath: string,
  roots: RuntimeRoots,
  mode?: WriteSandboxMode
): boolean {
  const m = mode ?? resolveWriteSandboxMode();
  if (m === "off") return true;
  const target = path.resolve(absPath);
  if (m === "roots") return isWithinAllowedRoots(target, roots);
  const ws = resolveEffectiveWorkspace(roots);
  return isSubPath(target, ws);
}

export interface SensitiveWriteCheck {
  blocked: boolean;
  code: string;
  reason: string;
}

/**
 * 敏感写目标检测（.env / 密钥文件）。
 * QLING_ALLOW_SENSITIVE_WRITE=1 时放行。
 */
export function checkSensitiveWriteTarget(
  absPath: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): SensitiveWriteCheck | null {
  const allow = String(env.QLING_ALLOW_SENSITIVE_WRITE ?? "").trim().toLowerCase();
  if (allow === "1" || allow === "true" || allow === "yes" || allow === "on") {
    return null;
  }

  const base = path.basename(absPath);
  const baseLower = base.toLowerCase();
  const norm = path.resolve(absPath).replace(/\\/g, "/").toLowerCase();

  if (SENSITIVE_BASENAME_EXACT.has(baseLower) || baseLower.startsWith(".env.")) {
    return {
      blocked: true,
      code: "WRITE_SENSITIVE_PATH",
      reason: `refusing to write sensitive file '${base}'. Set QLING_ALLOW_SENSITIVE_WRITE=1 to override.`,
    };
  }
  if (SENSITIVE_BASENAME_SUFFIXES.some((s) => baseLower.endsWith(s))) {
    return {
      blocked: true,
      code: "WRITE_SENSITIVE_PATH",
      reason: `refusing to write key-like file '${base}'. Set QLING_ALLOW_SENSITIVE_WRITE=1 to override.`,
    };
  }
  // 路径中显式 .git/credentials 等
  if (norm.includes("/.git/credentials") || norm.endsWith("/.git-credentials")) {
    return {
      blocked: true,
      code: "WRITE_SENSITIVE_PATH",
      reason: "refusing to write git credentials store.",
    };
  }
  return null;
}

export function resolveToolPath(
  inputPath: string,
  roots: RuntimeRoots,
  defaultRoot: DefaultRootKind = "workspace"
): string {
  const raw = inputPath.trim();
  if (!raw) return raw;

  const normalized = raw.replace(/\\/g, "/");

  if (normalized.startsWith("workspace_dir/")) {
    const rel = normalized.slice("workspace_dir/".length);
    const base = roots.workspaceDir ?? roots.fileCacheDir;
    return path.resolve(base, rel);
  }
  if (normalized.startsWith("file_cache_dir/")) {
    return path.resolve(roots.fileCacheDir, normalized.slice("file_cache_dir/".length));
  }
  if (normalized.startsWith("file_state_dir/")) {
    return path.resolve(roots.fileStateDir, normalized.slice("file_state_dir/".length));
  }

  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }

  const fallback = pickDefaultRoot(defaultRoot, roots);
  return path.resolve(fallback, raw);
}

export function isWithinAllowedRoots(absPath: string, roots: RuntimeRoots): boolean {
  const candidates = [roots.fileCacheDir, roots.fileStateDir];
  if (roots.workspaceDir) candidates.push(roots.workspaceDir);

  const target = path.resolve(absPath);
  return candidates.some((root) => isSubPath(target, path.resolve(root)));
}

function pickDefaultRoot(kind: DefaultRootKind, roots: RuntimeRoots): string {
  if (kind === "file_cache") return roots.fileCacheDir;
  if (kind === "file_state") return roots.fileStateDir;
  return roots.workspaceDir ?? roots.fileCacheDir;
}

function isSubPath(target: string, base: string): boolean {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

