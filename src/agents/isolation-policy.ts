import { existsSync } from "fs";
import path from "path";

export interface IsolationPolicyInput {
  workspaceDir: string;
  mode: "worktree" | "off";
  requireGit: boolean;
  nonGitPolicy: "warn" | "deny" | "off";
}

export interface IsolationPolicyResult {
  level: "ok" | "warn" | "deny";
  useWorktree: boolean;
  isGitWorkspace: boolean;
  message?: string;
}

function isGitWorkspace(workspaceDir: string): boolean {
  return existsSync(path.join(workspaceDir, ".git"));
}

export async function evaluateIsolationPolicy(
  input: IsolationPolicyInput
): Promise<IsolationPolicyResult> {
  const gitWorkspace = isGitWorkspace(input.workspaceDir);
  if (input.mode === "off") {
    return {
      level: "ok",
      useWorktree: false,
      isGitWorkspace: gitWorkspace,
    };
  }

  if (gitWorkspace) {
    return {
      level: "ok",
      useWorktree: true,
      isGitWorkspace: true,
      message: "Git workspace detected; worktree isolation is available.",
    };
  }

  if (!input.requireGit) {
    return {
      level: "ok",
      useWorktree: false,
      isGitWorkspace: false,
      message: "Non-git workspace; isolation continues without worktree.",
    };
  }

  if (input.nonGitPolicy === "deny") {
    return {
      level: "deny",
      useWorktree: false,
      isGitWorkspace: false,
      message: "Non-git workspace blocked by agents.isolation.non_git_policy=deny",
    };
  }

  if (input.nonGitPolicy === "warn") {
    return {
      level: "warn",
      useWorktree: false,
      isGitWorkspace: false,
      message: "Non-git workspace; degraded to non-worktree isolation.",
    };
  }

  return {
    level: "ok",
    useWorktree: false,
    isGitWorkspace: false,
  };
}
