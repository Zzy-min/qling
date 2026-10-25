import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { assertOwnedMutationPath, isRelativePathOwned, normalizeOwnedPaths } from "./ownership.js";

const execFileAsync = promisify(execFile);
let integrationTail: Promise<void> = Promise.resolve();

function serializeIntegration<T>(operation: () => Promise<T>): Promise<T> {
  const current = integrationTail.then(operation, operation);
  integrationTail = current.then(() => undefined, () => undefined);
  return current;
}

export interface WorktreeResult {
  path: string;
  branch: string;
  repositoryRoot: string;
  baseCommit: string;
}

type GitExecutor = (args: string[], cwd: string) => Promise<{ stdout: string }>;

function safeTaskId(taskId: string): string {
  const safe = taskId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  if (!safe) throw new Error("invalid worktree task id");
  return safe;
}

export class SubagentWorktreeManager {
  private readonly rootDir: string;
  private readonly executeGit: GitExecutor;

  constructor(options: { stateDir: string; executeGit?: GitExecutor }) {
    this.rootDir = path.resolve(options.stateDir, "agent-worktrees");
    this.executeGit = options.executeGit ?? (async (args, cwd) => {
      const result = await execFileAsync("git", args, { cwd, windowsHide: true, timeout: 30_000 });
      return { stdout: result.stdout };
    });
  }

  async create(input: { taskId: string; workspaceDir: string }): Promise<WorktreeResult> {
    const safe = safeTaskId(input.taskId);
    const repositoryRoot = (await this.executeGit(["rev-parse", "--show-toplevel"], input.workspaceDir)).stdout.trim();
    if (!repositoryRoot) throw new Error("worktree isolation requires a git repository");
    await fs.mkdir(this.rootDir, { recursive: true });
    const target = path.resolve(this.rootDir, safe);
    const relative = path.relative(this.rootDir, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("worktree target escaped state directory");
    try {
      await fs.access(target);
      throw new Error(`worktree target already exists: ${target}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const branch = `qling-agent/${safe}`;
    const baseCommit = (await this.executeGit(["rev-parse", "HEAD"], repositoryRoot)).stdout.trim();
    await this.executeGit(["worktree", "add", "-b", branch, target, "HEAD"], repositoryRoot);
    return { path: target, branch, repositoryRoot, baseCommit };
  }

  async listChangedFiles(worktreePath: string): Promise<string[]> {
    const tracked = (await this.executeGit(["diff", "--name-only", "--relative", "HEAD"], worktreePath)).stdout;
    const untracked = (await this.executeGit(["ls-files", "--others", "--exclude-standard"], worktreePath)).stdout;
    return [...new Set(`${tracked}\n${untracked}`.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
  }

  async integrateOwnedChanges(input: {
    worktreePath: string;
    workspaceDir: string;
    ownedPaths: readonly string[];
  }): Promise<string[]> {
    return serializeIntegration(async () => {
      const ownedPaths = normalizeOwnedPaths(input.ownedPaths);
      const changed = await this.listChangedFiles(input.worktreePath);
      const outside = changed.filter((file) => !isRelativePathOwned(file, ownedPaths));
      if (outside.length > 0) throw new Error(`changes outside ownership: ${outside.join(", ")}`);
      if (changed.length === 0) return [];

      const repositoryRoot = (await this.executeGit(["rev-parse", "--show-toplevel"], input.workspaceDir)).stdout.trim();
      const worktreeRoot = await fs.realpath(input.worktreePath);
      const planned: Array<{ target: string; content?: Buffer }> = [];
      for (const relativePath of changed) {
        await assertOwnedMutationPath({ workspaceDir: repositoryRoot, target: relativePath, ownedPaths });
        const source = path.resolve(worktreeRoot, relativePath);
        const target = path.resolve(repositoryRoot, relativePath);
        const sourceRelative = path.relative(worktreeRoot, source);
        if (sourceRelative.startsWith("..") || path.isAbsolute(sourceRelative)) throw new Error(`worktree source escaped root: ${relativePath}`);
        const readOptional = async (file: string): Promise<Buffer | null> => {
          try { return await fs.readFile(file); } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          }
        };
        const child = await readOptional(source);
        const parent = await readOptional(target);
        let base: Buffer | null = null;
        try {
          const shown = await this.executeGit(["show", `HEAD:${relativePath.replace(/\\/g, "/")}`], input.worktreePath);
          base = Buffer.from(shown.stdout);
        } catch {
          base = null;
        }

        if (parent?.equals(base ?? Buffer.alloc(0)) && base !== null) {
          planned.push({ target, ...(child ? { content: child } : {}) });
          continue;
        }
        if (base === null && parent === null) {
          planned.push({ target, ...(child ? { content: child } : {}) });
          continue;
        }
        if (child?.equals(base ?? Buffer.alloc(0)) && base !== null) continue;
        if (!base || !parent || !child || base.includes(0) || parent.includes(0) || child.includes(0)) {
          throw await this.createIntegrationConflict(relativePath, base, parent, child, "binary, create/delete, or missing-base conflict");
        }
        const merged = await this.mergeText(relativePath, base, parent, child);
        planned.push({ target, content: merged });
      }
      for (const operation of planned) {
        if (operation.content === undefined) {
          await fs.rm(operation.target, { force: true });
        } else {
          await fs.mkdir(path.dirname(operation.target), { recursive: true });
          await fs.writeFile(operation.target, operation.content);
        }
      }
      return changed;
    });
  }

  private async mergeText(relativePath: string, base: Buffer, parent: Buffer, child: Buffer): Promise<Buffer> {
    const temp = await fs.mkdtemp(path.join(this.rootDir, "merge-"));
    try {
      const parentPath = path.join(temp, "parent");
      const basePath = path.join(temp, "base");
      const childPath = path.join(temp, "child");
      await Promise.all([
        fs.writeFile(parentPath, parent),
        fs.writeFile(basePath, base),
        fs.writeFile(childPath, child),
      ]);
      try {
        const result = await execFileAsync("git", ["merge-file", "-p", parentPath, basePath, childPath], {
          windowsHide: true,
          timeout: 30_000,
          encoding: "buffer",
          maxBuffer: 20 * 1024 * 1024,
        });
        return Buffer.from(result.stdout);
      } catch (error) {
        const conflict = error as Error & { stdout?: Buffer | string };
        throw await this.createIntegrationConflict(
          relativePath,
          base,
          parent,
          child,
          conflict.stdout ? Buffer.from(conflict.stdout).toString("utf8") : conflict.message
        );
      }
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }

  private async createIntegrationConflict(
    relativePath: string,
    base: Buffer | null,
    parent: Buffer | null,
    child: Buffer | null,
    details: string
  ): Promise<Error> {
    const directory = path.join(this.rootDir, "integration-conflicts");
    await fs.mkdir(directory, { recursive: true });
    const safe = relativePath.replace(/[^a-z0-9_.-]+/gi, "-").slice(0, 80) || "file";
    const artifact = path.join(directory, `${Date.now()}-${safe}.txt`);
    const render = (label: string, content: Buffer | null) =>
      `--- ${label}\n${content === null ? "<missing>" : content.includes(0) ? `<binary ${content.length} bytes>` : content.toString("utf8")}`;
    await fs.writeFile(artifact, [details, render("base", base), render("parent", parent), render("child", child)].join("\n\n"), "utf8");
    return new Error(`integration conflict for ${relativePath}; conflict artifact: ${artifact}`);
  }
}
