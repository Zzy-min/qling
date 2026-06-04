import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as os from "os";
import * as path from "path";

export const DEFAULT_LOOP_INTERVAL_MS = 10 * 60 * 1000;
export const DEFAULT_MAINTENANCE_PROMPT = [
  "继续当前对话中已经授权但尚未完成的工作。",
  "如果当前工作区里有待验证的修改，优先完成验证并报告结果。",
  "如果没有待办事项，只输出一行：当前没有需要继续的工作。",
].join("\n");

export type LoopPromptSource = "inline" | "project" | "user" | "builtin";

export interface ResolvedLoopPrompt {
  prompt: string;
  source: LoopPromptSource;
  path?: string;
}

async function readPromptFile(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) return null;
  const raw = await fs.readFile(filePath, "utf-8");
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function resolveLoopPrompt(options: {
  workspaceDir: string;
  homeDir?: string;
  inlinePrompt?: string;
}): Promise<ResolvedLoopPrompt> {
  const inlinePrompt = options.inlinePrompt?.trim();
  if (inlinePrompt) {
    return {
      prompt: inlinePrompt,
      source: "inline",
    };
  }

  const homeDir = options.homeDir ?? os.homedir();
  const projectPromptPath = path.join(options.workspaceDir, ".claude", "loop.md");
  const userPromptPath = path.join(homeDir, ".claude", "loop.md");

  const projectPrompt = await readPromptFile(projectPromptPath);
  if (projectPrompt) {
    return {
      prompt: projectPrompt,
      source: "project",
      path: projectPromptPath,
    };
  }

  const userPrompt = await readPromptFile(userPromptPath);
  if (userPrompt) {
    return {
      prompt: userPrompt,
      source: "user",
      path: userPromptPath,
    };
  }

  return {
    prompt: DEFAULT_MAINTENANCE_PROMPT,
    source: "builtin",
  };
}
