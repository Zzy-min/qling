import * as os from "os";
import * as path from "path";

export interface RuntimeRoots {
  workspaceDir: string | null;
  fileCacheDir: string;
  fileStateDir: string;
}

export type DefaultRootKind = "workspace" | "file_cache" | "file_state";

const HOME = os.homedir();
const DEFAULT_STATE_DIR = path.join(HOME, ".qling");
const DEFAULT_CACHE_DIR = path.join(DEFAULT_STATE_DIR, "cache");

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

