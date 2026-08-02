import * as fs from "node:fs/promises";
import * as path from "node:path";

export function normalizeOwnedPaths(ownedPaths: readonly string[]): string[] {
  return [...new Set(ownedPaths.map((value) => value.trim()).filter(Boolean).map((value) => {
    if (path.isAbsolute(value) || value.split(/[\\/]+/).includes("..")) throw new Error(`owned path must be workspace-relative: ${value}`);
    const normalized = path.normalize(value).replace(/^[.][\\/]/, "");
    if (!normalized || normalized === ".") throw new Error("owned path must not be the workspace root");
    return normalized;
  }))];
}

export function isRelativePathOwned(candidate: string, ownedPaths: readonly string[]): boolean {
  if (path.isAbsolute(candidate) || candidate.split(/[\\/]+/).includes("..")) return false;
  const key = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  const normalized = key(path.normalize(candidate).replace(/^[.][\\/]/, ""));
  return ownedPaths.some((owned) => {
    const root = key(path.normalize(owned));
    return normalized === root || normalized.startsWith(`${root}${path.sep}`);
  });
}

export async function assertOwnedMutationPath(input: { workspaceDir: string; target: string; ownedPaths: readonly string[] }): Promise<void> {
  const ownedPaths = normalizeOwnedPaths(input.ownedPaths);
  if (!isRelativePathOwned(input.target, ownedPaths)) throw new Error(`target is outside owned_paths: ${input.target}`);
  const workspaceReal = await fs.realpath(input.workspaceDir);
  let probe = path.resolve(workspaceReal, input.target);
  while (true) {
    try {
      const probeReal = await fs.realpath(probe);
      const relativeReal = path.relative(workspaceReal, probeReal);
      if (relativeReal.startsWith("..") || path.isAbsolute(relativeReal)) throw new Error(`target escapes workspace through symlink: ${input.target}`);
      if (relativeReal && !isRelativePathOwned(relativeReal, ownedPaths)) throw new Error(`target escapes owned_paths through symlink: ${input.target}`);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(probe);
      if (parent === probe) throw error;
      probe = parent;
    }
  }
}
