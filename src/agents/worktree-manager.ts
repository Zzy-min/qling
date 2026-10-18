import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WorktreeResult {
  path: string;
  branch: string;
  repositoryRoot: string;
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
    await this.executeGit(["worktree", "add", "-b", branch, target, "HEAD"], repositoryRoot);
    return { path: target, branch, repositoryRoot };
  }

  async listChangedFiles(worktreePath: string): Promise<string[]> {
    const tracked = (await this.executeGit(["diff", "--name-only", "--relative", "HEAD"], worktreePath)).stdout;
    const untracked = (await this.executeGit(["ls-files", "--others", "--exclude-standard"], worktreePath)).stdout;
    return [...new Set(`${tracked}\n${untracked}`.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
  }
}
