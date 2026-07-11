// ============================================================
// 轻灵 - Subtask 隔离执行器
// 在同进程内创建独立 AgentLoop 实例；Phase 3.2 支持角色与回传契约
// ============================================================

import type { AgentConfig } from "../types.js";
import { AgentLoop } from "../agent-loop.js";
import {
  type SubAgentRole,
  buildRoleSystemPreamble,
  extractEvidenceHints,
  extractFilesTouchedFromMessages,
  filterToolsForRole,
  formatSubAgentReturnContract,
  normalizeSubAgentRole,
} from "../agents/roles.js";

export interface SubtaskConfig {
  task: string;
  parentContext?: string;
  maxIterations?: number;
  depth?: number;
  tools?: AgentConfig["tools"];
  timeoutMs?: number;
  /** explore | implement | review */
  role?: SubAgentRole | string;
}

export interface SubtaskResult {
  success: boolean;
  output: string;
  iterations: number;
  durationMs: number;
  role: SubAgentRole;
  filesTouched: string[];
  /** 已格式化的回传契约（父代理应优先使用） */
  contractText: string;
}

interface TimeoutController {
  setTimeout(callback: () => void, timeoutMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultTimeoutController: TimeoutController = {
  setTimeout: (callback, timeoutMs) => setTimeout(callback, timeoutMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export async function runWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timers: TimeoutController = defaultTimeoutController
): Promise<T> {
  let handle: unknown;
  const timeout = new Promise<never>((_, reject) => {
    handle = timers.setTimeout(
      () => reject(new Error(`Subtask timeout after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (handle !== undefined) timers.clearTimeout(handle);
  }
}

export class SubtaskRunner {
  private parentConfig: Partial<AgentConfig>;

  constructor(parentConfig: Partial<AgentConfig>) {
    this.parentConfig = parentConfig;
  }

  async run(config: SubtaskConfig): Promise<SubtaskResult> {
    const start = Date.now();
    const maxIter = config.maxIterations ?? 10;
    const timeout = config.timeoutMs ?? 120_000;
    const role = normalizeSubAgentRole(config.role);

    const baseTools =
      config.tools ??
      this.parentConfig.tools?.filter((t) => t.name !== "subtask") ??
      [];
    const tools = filterToolsForRole(baseTools, role);

    const subtaskConfig: Partial<AgentConfig> = {
      ...this.parentConfig,
      tools,
      maxIterations: maxIter,
    };

    const subAgent = new AgentLoop(subtaskConfig);
    await subAgent.waitForInit();

    const preamble = buildRoleSystemPreamble(role);
    let prompt = `${preamble}\n\n[子任务]\n${config.task}`;
    if (config.parentContext) {
      prompt =
        `${preamble}\n\n[父任务上下文]\n${config.parentContext}\n\n[子任务]\n${config.task}`;
    }
    subAgent.addUserMessage(prompt);

    let rawOutput = "";
    let success = false;
    try {
      rawOutput = await runWithTimeout(subAgent.run(), timeout);
      success = true;
    } catch (err) {
      rawOutput = (err as Error).message;
      success = false;
    } finally {
      try {
        await subAgent.shutdown();
      } catch {
        // ignore shutdown errors
      }
    }

    const messages = subAgent.getMessagesSnapshot?.() ?? [];
    const filesTouched = extractFilesTouchedFromMessages(messages);
    const summary = buildSummary(rawOutput, success, role, filesTouched);
    const evidence = extractEvidenceHints(rawOutput);
    if (!success) {
      evidence.unshift(`失败: ${rawOutput.slice(0, 200)}`);
    }

    const durationMs = Date.now() - start;
    const contractText = formatSubAgentReturnContract({
      role,
      success,
      durationMs,
      iterations: maxIter,
      summary,
      filesTouched,
      evidence,
      rawOutput,
    });

    return {
      success,
      output: contractText,
      iterations: maxIter,
      durationMs,
      role,
      filesTouched,
      contractText,
    };
  }
}

function buildSummary(
  raw: string,
  success: boolean,
  role: SubAgentRole,
  files: string[]
): string {
  const firstLine =
    raw
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("【")) ?? "";
  const fileHint = files.length > 0 ? ` 触及 ${files.length} 个文件` : "";
  if (!success) {
    return `角色 ${role} 未完成${fileHint}: ${firstLine.slice(0, 120) || "见 evidence"}`;
  }
  return (
    firstLine.slice(0, 200) ||
    `角色 ${role} 已完成${fileHint}`
  );
}
