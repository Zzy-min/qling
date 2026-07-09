// ============================================================
// 轻灵 - 写工具后的可选 Git 自动提交策略
// QLING_GIT_AUTO_COMMIT=off|on|ask  （默认 off）
// ============================================================

import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { join, relative, resolve } from "path";

const execFileAsync = promisify(execFile);

export type GitAutoCommitMode = "off" | "on" | "ask";

export interface AutoCommitInput {
  workspaceDir: string;
  filePath: string;
  toolName: string;
  mode?: GitAutoCommitMode;
  /** 可注入以便单测 */
  runGit?: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
  isGitRepo?: (cwd: string) => boolean;
}

export interface AutoCommitResult {
  mode: GitAutoCommitMode;
  attempted: boolean;
  committed: boolean;
  message: string;
  commitSubject?: string;
}

export function resolveGitAutoCommitMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): GitAutoCommitMode {
  const raw = String(env.QLING_GIT_AUTO_COMMIT ?? "off").trim().toLowerCase();
  if (raw === "on" || raw === "true" || raw === "1" || raw === "yes") return "on";
  if (raw === "ask" || raw === "prompt") return "ask";
  return "off";
}

function defaultIsGitRepo(cwd: string): boolean {
  return existsSync(join(cwd, ".git"));
}

async function defaultRunGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const res = await execFileAsync("git", args, {
    cwd,
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  return {
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
  };
}

export function buildAutoCommitSubject(toolName: string, relPath: string): string {
  const safeTool = toolName.replace(/[^\w.-]+/g, "") || "edit";
  const safePath = relPath.replace(/\\/g, "/");
  return `qling: ${safeTool} ${safePath}`.slice(0, 200);
}

/**
 * 在 write/patch 成功后按策略尝试 git add + commit。
 * 失败不抛到调用方工具结果（返回 message 由上层附加提示）。
 */
export async function maybeAutoCommitAfterWrite(input: AutoCommitInput): Promise<AutoCommitResult> {
  const mode = input.mode ?? resolveGitAutoCommitMode();
  const workspaceDir = resolve(input.workspaceDir || process.cwd());
  const absPath = resolve(input.filePath);
  let relPath: string;
  try {
    relPath = relative(workspaceDir, absPath).replace(/\\/g, "/") || absPath;
  } catch {
    relPath = absPath;
  }

  if (mode === "off") {
    return {
      mode,
      attempted: false,
      committed: false,
      message: "git auto-commit=off",
    };
  }

  if (mode === "ask") {
    return {
      mode,
      attempted: false,
      committed: false,
      message: `git auto-commit=ask：已修改 ${relPath}。确认后可运行 /commit 提交。`,
    };
  }

  // mode === "on"
  const isGit = (input.isGitRepo ?? defaultIsGitRepo)(workspaceDir);
  if (!isGit) {
    return {
      mode,
      attempted: false,
      committed: false,
      message: `git auto-commit=on 但 ${workspaceDir} 不是 git 仓库，已跳过。`,
    };
  }

  const runGit = input.runGit ?? defaultRunGit;
  const subject = buildAutoCommitSubject(input.toolName, relPath);

  try {
    await runGit(["add", "--", absPath], workspaceDir);
    const status = await runGit(["status", "--porcelain", "--", absPath], workspaceDir);
    if (!String(status.stdout || "").trim()) {
      return {
        mode,
        attempted: true,
        committed: false,
        message: `git auto-commit: ${relPath} 无待提交变更（可能已被忽略）。`,
        commitSubject: subject,
      };
    }
    await runGit(["commit", "-m", subject], workspaceDir);
    return {
      mode,
      attempted: true,
      committed: true,
      message: `git auto-commit: 已提交「${subject}」`,
      commitSubject: subject,
    };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      mode,
      attempted: true,
      committed: false,
      message: `git auto-commit 失败: ${detail}`,
      commitSubject: subject,
    };
  }
}
