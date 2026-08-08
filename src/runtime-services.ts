import type { MemoryStore } from "./memory.js";
import type { MCPRegistry } from "./mcp/registry.js";
import type { LlmHttpClient } from "./providers/llm-client.js";
import { createToolDispatcher, type ToolDispatcher } from "./tools/index.js";
import { runWithRuntimeRoots } from "./runtime-paths.js";

export interface RuntimeConfigSnapshot {
  provider: string;
  model: string;
  workspaceDir: string | null;
  stateDir: string;
  fileCacheDir: string;
  toolAllowlist: string[] | null;
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
    const dispatch = createToolDispatcher({
      mcpRegistry: () => this.registry,
      allowedNames: config.toolAllowlist ? new Set(config.toolAllowlist) : undefined,
    });
    this.dispatchTool = (toolCall) => runWithRuntimeRoots({
      workspaceDir: config.workspaceDir,
      fileCacheDir: config.fileCacheDir,
      fileStateDir: config.stateDir,
    }, () => dispatch(toolCall));
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
