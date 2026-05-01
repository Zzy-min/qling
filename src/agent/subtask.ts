// ============================================================
// 轻灵 - Subtask 隔离执行器
// 在同进程内创建独立 AgentLoop 实例，共享 MemoryStore
// ============================================================

import type { AgentConfig, Message } from "../types.js";
import { AgentLoop } from "../agent-loop.js";

export interface SubtaskConfig {
  task: string;
  parentContext?: string;
  maxIterations?: number;
  depth?: number;
  tools?: AgentConfig["tools"];
  timeoutMs?: number;
}

export interface SubtaskResult {
  success: boolean;
  output: string;
  iterations: number;
  durationMs: number;
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
    const depth = config.depth ?? 1;

    // depth enforcement: if depth >= 1, subtask cannot spawn further subtasks
    const tools = config.tools ?? this.parentConfig.tools?.filter((t) => t.name !== "subtask") ?? [];

    const subtaskConfig: Partial<AgentConfig> = {
      ...this.parentConfig,
      tools,
      maxIterations: maxIter,
    };

    const subAgent = new AgentLoop(subtaskConfig);
    await subAgent.waitForInit();

    // inject parent context + task
    let prompt = config.task;
    if (config.parentContext) {
      prompt = "[父任务上下文]\n" + config.parentContext + "\n\n[子任务]\n" + config.task;
    }
    subAgent.addUserMessage(prompt);

    try {
      const output = await Promise.race([
        subAgent.run(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Subtask timeout")), timeout)
        ),
      ]);

      return {
        success: true,
        output,
        iterations: maxIter,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        output: (err as Error).message,
        iterations: maxIter,
        durationMs: Date.now() - start,
      };
    } finally {
      await subAgent.shutdown();
    }
  }
}
