import type { MemoryStore } from "./memory.js";
import type { MCPRegistry } from "./mcp/registry.js";
import type { LlmHttpClient } from "./providers/llm-client.js";
import { createToolDispatcher, type ToolDispatcher } from "./tools/index.js";

export interface RuntimeConfigSnapshot {
  provider: string;
  model: string;
  workspaceDir: string | null;
  stateDir: string;
}

/** Agent-owned services. No mutable process-wide registry participates in dispatch. */
export class RuntimeServices {
  readonly config: Readonly<RuntimeConfigSnapshot>;
  readonly dispatchTool: ToolDispatcher;
  private registry: MCPRegistry | null = null;

  constructor(
    readonly provider: LlmHttpClient,
    readonly memory: MemoryStore,
    config: RuntimeConfigSnapshot
  ) {
    this.config = Object.freeze({ ...config });
    this.dispatchTool = createToolDispatcher({ mcpRegistry: () => this.registry });
  }

  setMcpRegistry(registry: MCPRegistry | null): void {
    this.registry = registry;
  }

  getMcpRegistry(): MCPRegistry | null {
    return this.registry;
  }

  async shutdown(): Promise<void> {
    const registry = this.registry;
    this.registry = null;
    if (registry) await registry.disconnectAll();
  }
}
