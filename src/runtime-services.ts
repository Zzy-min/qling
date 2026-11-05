import type { MemoryStore } from "./memory.js";
import type { MCPRegistry } from "./mcp/registry.js";
import type { LlmHttpClient } from "./providers/llm-client.js";
import { createToolDispatcher, type ToolDispatcher } from "./tools/index.js";
import { runWithRuntimeRoots } from "./runtime-paths.js";
import {
  runWithSubagentParentScope,
  type SubagentParentScope,
} from "./runtime/subagent-scope.js";

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
  private ownsRegistry = false;
  private parentScope: (() => SubagentParentScope) | null = null;

  constructor(
    readonly provider: LlmHttpClient,
    readonly memory: MemoryStore,
    config: RuntimeConfigSnapshot,
    options: { signal?: () => AbortSignal | undefined } = {},
  ) {
    this.config = Object.freeze({ ...config });
    const dispatch = createToolDispatcher({
      mcpRegistry: () => this.registry,
      allowedNames: config.toolAllowlist ? new Set(config.toolAllowlist) : undefined,
      computerUseConfig: {
        enabled: /^(1|true|yes|on)$/i.test(process.env.QLING_FEATURES_COMPUTER_USE ?? ""),
        driverPath: process.env.QLING_COMPUTER_USE_DRIVER_PATH ?? "", stateDir: config.stateDir,
      },
      signal: options.signal,
    });
    this.dispatchTool = (toolCall) => runWithRuntimeRoots({
      workspaceDir: config.workspaceDir,
      fileCacheDir: config.fileCacheDir,
      fileStateDir: config.stateDir,
    }, () => {
      const scope = this.parentScope?.();
      const exec = () => dispatch(toolCall);
      return scope ? runWithSubagentParentScope(scope, exec) : exec();
    });
    this.dispatchTool.close = dispatch.close;
  }

  setParentScope(provider: () => SubagentParentScope): void {
    this.parentScope = provider;
  }

  setMcpRegistry(registry: MCPRegistry | null, options?: { own?: boolean }): void {
    this.registry = registry;
    this.ownsRegistry = Boolean(registry) && options?.own !== false;
  }

  getMcpRegistry(): MCPRegistry | null {
    return this.registry;
  }

  async shutdown(): Promise<void> {
    await this.dispatchTool.close?.();
    const registry = this.registry;
    const ownsRegistry = this.ownsRegistry;
    this.registry = null;
    this.ownsRegistry = false;
    if (ownsRegistry && registry) await registry.disconnectAll();
  }
}
