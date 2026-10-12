import { AsyncLocalStorage } from "node:async_hooks";

export interface SubagentHookRunner {
  subagentStart(payload: { role: string; task: string }): Promise<void>;
  subagentStop(payload: {
    role: string;
    task: string;
    success: boolean;
    durationMs: number;
  }): Promise<void>;
}

export interface SubagentMcpRegistry {
  getAllTools(): Array<{
    serverName: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  }>;
}

/** 父 agent 在工具分发期间暴露给 SubtaskRunner 的钩子与 MCP registry。 */
export interface SubagentParentScope {
  sessionId: string;
  hookRunner: SubagentHookRunner | null;
  mcpRegistry: SubagentMcpRegistry | null;
}

const storage = new AsyncLocalStorage<SubagentParentScope>();

export function runWithSubagentParentScope<T>(scope: SubagentParentScope, fn: () => T): T {
  return storage.run(scope, fn);
}

export function getSubagentParentScope(): SubagentParentScope | undefined {
  return storage.getStore();
}
