// ============================================================
// 轻灵 - Agent Loop v2（整合 Pipeline Hook + Section Prompt）
// Token 计数仅采用 provider 官方 usage 字段。
// ============================================================

import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { ALL_TOOLS, setMCPRegistry } from "./tools/index.js";
import { HookManager, ToolPipeline } from "./pipeline/hooks.js";
import { buildDefaultRegistry } from "./pipeline/sections.js";
import { MemoryStore } from "./memory.js";
import type { TokenUsageSource } from "./token-usage.js";
import { WriteAheadLog } from "./memory/wal.js";
import { runAutoDream } from "./memory/lifecycle.js";
import { MCPRegistry } from "./mcp/registry.js";
import { mcpToolsToNativeDefinitions } from "./mcp/bridge.js";
import { ApprovalGate } from "./guard/approval.js";
import { MetricsCollector } from "./metrics/collector.js";
import { AgentTelemetry } from "./metrics/agent-telemetry.js";
import type { Channel } from "./channels/types.js";
import type { MCPServerConfig } from "./types.js";
import { VerificationAgent } from "./pipeline/verification.js";
import { ContextCompactor } from "./context-compactor.js";
import { KnowledgeAgentAdapter } from "./knowledge-agent.js";
import type { AgentConfig, Message, ToolCall } from "./types.js";
import { WorkflowRuntime } from "./workflow-runtime.js";
import { WorkflowBuilder } from "./workflow-types.js";
import { DiscoveryRegistry } from "./discovery-registry.js";
import { DiscoverySource } from "./discovery-types.js";
import { MissionManager } from "./mission/manager.js";
import { getSkillDirs } from "./tools/skill.js";
import { listSkills } from "./skills/registry.js";
import { buildSkillsSection } from "./pipeline/sections.js";
import { setCustomPatterns } from "./guard/content-filter.js";
import { guardConfigFromEnv, type GuardConfig } from "./config.js";
import {
  SessionRegistry,
  type SavedSessionSnapshot,
  type SavedSessionSummary,
} from "./session/session-registry.js";
import {
  applySessionSnapshot,
  buildSessionSnapshot,
  defaultSessionSaveName,
} from "./session/session-persistence.js";
import {
  apiKeyRequiredForEndpoint,
  isLoopbackEndpoint,
} from "./providers/presets.js";
import { LlmHttpClient, type LlmChatResponse } from "./providers/llm-client.js";
import { ExecutionEventBus } from "./execution/event-bus.js";
import { RecoveryController } from "./execution/recovery-controller.js";
import { RunTraceStore } from "./execution/run-trace-store.js";
import type { ExecutionEvent, RecoveryState } from "./execution/types.js";
import {
  formatRecoveryInstruction,
  formatRecoveryPause,
} from "./execution/recovery-messages.js";
import {
  loadVerificationCommand as loadVerificationCommandFile,
  persistVerificationCommand as persistVerificationCommandFile,
  runShellCommand,
  stagesSummary,
} from "./execution/verification-loop.js";
import {
  assembleSystemPrompt,
  reflectiveThink,
} from "./agent/system-prompt.js";
import {
  runInnerIterationLoop,
  runOuterAgentLoop,
  type TokenCounters,
} from "./agent/main-loop.js";

/** Minimal surface so agent-runtime does not statically import adapters/dashboard. */
interface DashboardHandle {
  start(): Promise<void>;
  stop(): void;
}

const HOME_DIR = os.homedir();
const DEFAULT_QLING_DIR = path.join(HOME_DIR, ".qling");
const EXPLICIT_ENABLE_VALUES = new Set(["1", "true", "on", "yes"]);

export function resolveMemoryDreamLlmEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  return EXPLICIT_ENABLE_VALUES.has(
    String(env.QLING_MEMORY_DREAM_LLM_ENABLED ?? "").trim().toLowerCase()
  );
}

/** 本地 loopback / ollama 允许空 key，用占位符满足 OpenAI 兼容 Authorization 头 */
function resolveSessionApiKey(raw: string, endpoint: string, provider: string): string {
  const trimmed = String(raw ?? "").trim();
  if (trimmed) return trimmed;
  if (!apiKeyRequiredForEndpoint(endpoint, provider) || isLoopbackEndpoint(endpoint)) {
    return "local";
  }
  return "";
}

export interface LlmSessionPatch {
  model?: string;
  provider?: string;
  endpoint?: string;
  apiKey?: string;
}

export class AgentEventEmitter {
  private handlers = new Map<string, Set<Function>>();

  on(event: string, handler: Function): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.forEach((h) => h(...args));
  }
}

export class AgentLoop extends AgentEventEmitter {
  // --- 核心组件 ---
  private llmClient: LlmHttpClient;
  private messages: Message[] = [];
  private config: AgentConfig;
  private turnCount = 0;
  private runtimeRootDir: string;
  private memoryDir: string;
  private loggingConfig: NonNullable<AgentConfig["logging"]>;

  // v2 新组件
  private hookManager: HookManager;
  private pipeline: ToolPipeline;
  private sectionRegistry = buildDefaultRegistry(ALL_TOOLS);
  private memoryStore: MemoryStore;
  private verifier: VerificationAgent;
  private compactor: ContextCompactor;
  private knowledgeAdapter: KnowledgeAgentAdapter;
  private workflowRuntime: WorkflowRuntime;
  private wal: WriteAheadLog | null = null;
  private memoryWalEnabled = false;
  private memoryDreamLLMEnabled = false;
  private memoryDreamTurnThreshold = 24;
  private memoryMaxEntries = 1000;
  private mcpRegistry: MCPRegistry | null = null;
  private approvalGate: ApprovalGate;
  private metricsCollector: MetricsCollector | null = null;
  private metricsFlushTimer: ReturnType<typeof setInterval> | null = null;
  private dashboardServer: DashboardHandle | null = null;
  private discoveryRegistry: DiscoveryRegistry;
  private missionManager: MissionManager;
  private telemetry: AgentTelemetry | null = null;
  private channel: Channel | null = null;
  private sessionId: string;
  private sessionCreatedAt: string;
  private sessionRegistry: SessionRegistry;
  private guardConfig: GuardConfig;
  private verificationCommand: string | null = null;
  private readonly executionEventBus = new ExecutionEventBus();
  private readonly recoveryController = new RecoveryController();
  private runTraceStore: RunTraceStore;
  private activeRun: { runId: string; sessionId: string; originalTask: string; startedAt: number } | null = null;

  // --- v0.3 Getters (Management) ---
  getWorkflowRuntime(): WorkflowRuntime { return this.workflowRuntime; }
  getMemoryStore(): MemoryStore { return this.memoryStore; }
  getDiscoveryRegistry(): DiscoveryRegistry { return this.discoveryRegistry; }
  getMissionManager(): MissionManager { return this.missionManager; }
  getRuntimeRootDir(): string { return this.runtimeRootDir; }
  getWorkspaceDir(): string { return this.config.runtime?.workspaceDir ?? process.cwd(); }
  getMessagesSnapshot(): Message[] { return this.messages.map((message) => ({ ...message })); }
  getVerificationCommand(): string | null { return this.verificationCommand; }
  getActiveRun(): Readonly<typeof this.activeRun> { return this.activeRun ? { ...this.activeRun } : null; }
  getRecoveryState(): RecoveryState | null {
    try { return this.recoveryController.getRecoveryState(); } catch { return null; }
  }
  subscribeExecutionEvents(listener: (event: ExecutionEvent) => void): () => void {
    return this.executionEventBus.subscribe(listener);
  }
  applyRecoveryAction(action: "retry" | "next" | "edit" | "cancel"): {
    state: RecoveryState;
    prompt?: string;
  } {
    const state = this.recoveryController.applyAction(action);
    if ((action === "cancel" || action === "edit") && this.activeRun) {
      this.executionEventBus.completeRun(this.activeRun.runId, "canceled");
      this.activeRun = null;
    }
    return { state, ...(action === "edit" ? { prompt: state.originalTask } : {}) };
  }
  async listRunTraceIds(): Promise<string[]> { return this.runTraceStore.listRunIds(this.sessionId); }
  async readRunTrace(runId: string): Promise<ExecutionEvent[]> { return this.runTraceStore.readRun(this.sessionId, runId); }
  async getRecentRunTrace(sessionId = this.sessionId, runId?: string): Promise<ExecutionEvent[]> {
    const target = runId ?? (await this.runTraceStore.listRunIds(sessionId))[0];
    if (!target) return [];
    return (await this.runTraceStore.queryRecent(sessionId, target, { limit: 50 })).events;
  }
  async setVerificationCommand(cmd: string | null): Promise<void> {
    this.verificationCommand = cmd;
    await this.persistVerificationCommand();
  }
  getSessionStats(): {
    sessionId: string;
    turnCount: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
    tokenSource: TokenUsageSource;
    compactions: number;
  } {
    return {
      sessionId: this.sessionId,
      turnCount: this.turnCount,
      tokens: this.sessionTokens,
      promptTokens: this.sessionPromptTokens,
      completionTokens: this.sessionCompletionTokens,
      tokenSource: this.tokenUsageSource,
      compactions: this.compactionCount,
    };
  }
  getSessionSummary(): SavedSessionSummary {
    return {
      name: this.sessionId,
      sessionId: this.sessionId,
      workspaceDir: this.getWorkspaceDir(),
      createdAt: this.sessionCreatedAt,
      updatedAt: new Date().toISOString(),
      turnCount: this.turnCount,
      messageCount: this.messages.length,
      sessionTokens: this.sessionTokens,
      compactionCount: this.compactionCount,
    };
  }

  /** 状态机恢复后的内部同步 */
  syncWorkflowState(checkpoint: any): void {
    if (checkpoint.history) {
      this.turnCount = checkpoint.history.length;
    }
    if (checkpoint.contextSnapshot) {
      this.messages = checkpoint.contextSnapshot;
    }
  }

  // Token 追踪：仅累加 provider 官方 usage（按请求增量）
  private sessionTokens = 0;
  private sessionPromptTokens = 0;
  private sessionCompletionTokens = 0;
  private tokenUsageSource: TokenUsageSource = "unknown";
  private initPromise: Promise<void>;

  // 轻量观测指标
  private compactionCount = 0;
  private retryCountTotal = 0;
  private toolCallTotal = 0;
  private toolFailureTotal = 0;

  constructor(config: Partial<AgentConfig> = {}) {
    super();
    const provider = config.provider ?? process.env.QLING_LLM_PROVIDER ?? "deepseek";
    const endpoint =
      config.endpoint ??
      process.env.QLING_LLM_ENDPOINT ??
      process.env.OPENAI_BASE_URL ??
      process.env.DEEPSEEK_BASE_URL ??
      (provider === "openai"
        ? "https://api.openai.com/v1"
        : provider === "ollama" || provider === "local"
          ? "http://localhost:11434/v1"
          : "https://api.deepseek.com");

    const rawApiKey =
      config.apiKey ??
      process.env.QLING_LLM_API_KEY ??
      process.env.DEEPSEEK_API_KEY ??
      process.env.OPENAI_API_KEY ??
      "";
    const apiKey = resolveSessionApiKey(rawApiKey, endpoint, provider);
    if (!apiKey) {
      throw new Error(
        "Missing API key (expected config.apiKey / QLING_LLM_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY)。本地 Ollama 可将 endpoint 设为 http://localhost:11434/v1 以跳过密钥。"
      );
    }
    this.runtimeRootDir = path.resolve(
      config.runtime?.fileStateDir ??
        process.env.QLING_FILE_STATE_DIR ??
        DEFAULT_QLING_DIR
    );
    this.runTraceStore = new RunTraceStore({ rootDir: path.join(this.runtimeRootDir, "runs") });
    this.executionEventBus.subscribe((event) => {
      void this.runTraceStore.append(event).catch(() => undefined);
      this.emit("execution", event);
    });
    this.memoryDir = path.join(this.runtimeRootDir, "memory");
    this.loggingConfig = {
      level: config.logging?.level ?? "info",
      format: config.logging?.format ?? "text",
      inspectPrompt: config.logging?.inspectPrompt ?? false,
      inspectRequest: config.logging?.inspectRequest ?? false,
      inspectDumpDir: config.logging?.inspectDumpDir ?? path.join(this.runtimeRootDir, "inspect"),
    };

    this.config = {
      apiKey,
      provider,
      endpoint,
      model: config.model ?? "deepseek-chat",
      systemPrompt: config.systemPrompt ?? "",
      maxIterations: config.maxIterations ?? 50,
      tools: config.tools ?? ALL_TOOLS,
      runtime: {
        workspaceDir: config.runtime?.workspaceDir ?? process.env.QLING_WORKSPACE_DIR ?? process.cwd(),
        fileCacheDir:
          config.runtime?.fileCacheDir ??
          process.env.QLING_FILE_CACHE_DIR ??
          path.join(this.runtimeRootDir, "cache"),
        fileStateDir: this.runtimeRootDir,
        maxSteps: config.runtime?.maxSteps ?? 50,
        parseRetries: config.runtime?.parseRetries ?? 2,
        toolRepeatLimit: config.runtime?.toolRepeatLimit ?? 6,
        timeoutMs: config.runtime?.timeoutMs ?? 300_000,
      },
      logging: this.loggingConfig,
    };
    this.sectionRegistry = buildDefaultRegistry(this.config.tools);
    this.sessionId = "session-" + Date.now();
    this.sessionCreatedAt = new Date().toISOString();
    this.approvalGate = new ApprovalGate();
    this.guardConfig = guardConfigFromEnv();
    this.sessionRegistry = new SessionRegistry({ stateDir: this.runtimeRootDir });

    // 初始化 v2 组件
    this.hookManager = new HookManager(this.config.tools, this.guardConfig);
    this.pipeline = new ToolPipeline(this.config.tools, this.hookManager);
    this.pipeline.setSessionId(this.sessionId);
    this.memoryStore = new MemoryStore(this.memoryDir, {
      workspaceDir: this.config.runtime?.workspaceDir || undefined,
    });
    this.verifier = new VerificationAgent(apiKey, this.config.model);
    this.compactor = new ContextCompactor(6000, this.config.model);
    this.knowledgeAdapter = new KnowledgeAgentAdapter(this.memoryStore);

    // v0.3 Workflow Runtime
    this.workflowRuntime = new WorkflowRuntime(
      path.join(this.runtimeRootDir, "workflows")
    );

    // v0.3 Discovery Registry
    const discoverySources: DiscoverySource[] = [];
    try {
      const localDirs = JSON.parse(process.env.QLING_DISCOVERY_LOCAL_DIRS || "[]");
      localDirs.forEach((dir: string, i: number) => {
        discoverySources.push({ id: `local-${i}`, uri: dir, type: "local" });
      });
      const remoteManifests = JSON.parse(process.env.QLING_DISCOVERY_REMOTE_MANIFESTS || "[]");
      remoteManifests.forEach((url: string, i: number) => {
        discoverySources.push({ id: `remote-${i}`, uri: url, type: "remote" });
      });
    } catch {
      // ignore parse errors
    }
    this.discoveryRegistry = new DiscoveryRegistry(discoverySources, {
      guardConfig: this.guardConfig,
    });
    this.missionManager = new MissionManager(this.runtimeRootDir);

    // HTTP client（foundation: providers/llm-client）
    this.llmClient = new LlmHttpClient({
      endpoint,
      apiKey: this.config.apiKey,
      timeoutMs: this.resolveLlmRequestTimeout(),
      provider: this.config.provider,
      onRetry: () => {
        this.retryCountTotal++;
      },
    });

    // 初始化系统（存储 promise，在 run() 中 await）
    this.initPromise = this.init();
  }

  async waitForInit(): Promise<void> {
    return this.initPromise;
  }

  private async init(): Promise<void> {
    await fs.mkdir(this.runtimeRootDir, { recursive: true });
    await fs.mkdir(this.memoryDir, { recursive: true });
    await this.missionManager.init();
    await this.loadVerificationCommand();

    // v0.3 Sync dynamic discovery
    if (process.env.QLING_FEATURES_DYNAMIC_DISCOVERY === "true") {
      console.error("🔍 正在同步动态插件与技能...");
      await this.discoveryRegistry.syncAll();
      const discoveredTools = this.discoveryRegistry.getDiscoveredTools();
      const executableTools = this.discoveryRegistry.getExecutableTools();
      if (executableTools.length > 0) {
        this.config.tools = [...this.config.tools, ...executableTools];
      }
      if (discoveredTools.length > executableTools.length) {
        console.error(
          `📦 已发现 ${discoveredTools.length} 个工具定义；未绑定执行器，仅作为本地元数据展示`
        );
      }
    }

    if (this.loggingConfig.inspectPrompt || this.loggingConfig.inspectRequest) {
      await fs.mkdir(this.loggingConfig.inspectDumpDir, { recursive: true });
    }

    // WAL initialization
    const walEnabled = process.env.QLING_MEMORY_WAL_ENABLED !== "false";
    const projectionIntervalRaw = Number(process.env.QLING_MEMORY_PROJECTION_INTERVAL_MS ?? "5000");
    const projectionInterval =
      Number.isFinite(projectionIntervalRaw) && projectionIntervalRaw > 0
        ? projectionIntervalRaw
        : 5000;
    const dreamLLM = resolveMemoryDreamLlmEnabled();
    const dreamThresholdRaw = Number(process.env.QLING_MEMORY_DREAM_TURN_THRESHOLD ?? "24");
    const dreamThreshold =
      Number.isFinite(dreamThresholdRaw) && dreamThresholdRaw > 0
        ? dreamThresholdRaw
        : 24;
    const memoryMaxEntriesRaw = Number(process.env.QLING_MEMORY_MAX_MEMORIES ?? "1000");
    this.memoryMaxEntries =
      Number.isFinite(memoryMaxEntriesRaw) && memoryMaxEntriesRaw > 0
        ? Math.floor(memoryMaxEntriesRaw)
        : 1000;
    this.memoryWalEnabled = walEnabled;
    this.memoryDreamLLMEnabled = dreamLLM;
    this.memoryDreamTurnThreshold = dreamThreshold;

    if (walEnabled) {
      try {
        const walDir = path.join(this.memoryStore.getWorkspaceMemoryDir(), "wal");
        this.wal = new WriteAheadLog(walDir);
        await this.wal.init();
        this.memoryStore.setWAL(this.wal, { intervalMs: projectionInterval });

        // v0.3 语义记忆初始化 (v0.5 升级为认知引擎)
        const semanticEnabled = process.env.QLING_FEATURES_SEMANTIC_MEMORY === "true";
        if (semanticEnabled) {
          const { CognitiveIndex } = await import("./memory/cognitive-index.js");
          const { EmbeddingClient } = await import("./memory/embedding.js");

          const cognitiveIndex = new CognitiveIndex(this.memoryStore.getWorkspaceMemoryDir());
          let embedEndpoint = process.env.QLING_MEMORY_SEMANTIC_ENDPOINT || this.config.endpoint;
          if (!embedEndpoint) {
            embedEndpoint = this.config.provider === "openai" ? "https://api.openai.com/v1" : "https://api.deepseek.com/v1";
          } else if (!/\/v1\/?$/.test(embedEndpoint)) {
            embedEndpoint = embedEndpoint.replace(/\/$/, "") + "/v1";
          }
          const embeddingClient = new EmbeddingClient({
            apiKey: process.env.QLING_MEMORY_SEMANTIC_API_KEY || this.config.apiKey,
            endpoint: embedEndpoint,
            model: process.env.QLING_MEMORY_SEMANTIC_MODEL || "text-embedding-3-small",
            dimensions: Number(process.env.QLING_MEMORY_SEMANTIC_DIM) || 1536,
          });

          this.memoryStore.setCognitiveIndex(cognitiveIndex, embeddingClient);
          console.error("🧠 认知引擎模块已启动 (Triple-Path Retrieval Mode)");
        }

        this.memoryStore.startProjection();
        console.error("[Memory] WAL enabled, projection interval=" + projectionInterval + "ms");
      } catch (err) {
        console.error("[Memory] WAL init failed, falling back to direct writes: " + (err as Error).message);
        this.wal = null;
        this.memoryWalEnabled = false;
      }
    }

    try {
      await this.memoryStore.init();
    } catch {
      // ignore
    }

    // Metrics & Dashboard initialization
    const metricsEnabled = process.env.QLING_METRICS_ENABLED === "true";
    const dashboardEnabled = process.env.QLING_FEATURES_DASHBOARD === "true";

    if (metricsEnabled || dashboardEnabled) {
      try {
        const metricsDir = path.resolve(
          process.env.QLING_METRICS_DIR ?? path.join(this.runtimeRootDir, "metrics")
        );
        const flushIntervalRaw = Number(process.env.QLING_METRICS_FLUSH_INTERVAL_MS ?? "10000");
        const flushIntervalMs =
          Number.isFinite(flushIntervalRaw) && flushIntervalRaw > 0
            ? flushIntervalRaw
            : 10000;

        this.metricsCollector = new MetricsCollector(metricsDir, this.sessionId, flushIntervalMs);
        await this.metricsCollector.init();
        this.metricsFlushTimer = this.metricsCollector.startAutoFlush();
        this.telemetry = new AgentTelemetry(this.metricsCollector, this.sessionId);

        if (metricsEnabled) {
          console.error("[Metrics] enabled, dir=" + metricsDir);
        }

        // v0.3 Dashboard Server — dynamic import keeps agent-runtime free of adapters static edge
        if (dashboardEnabled) {
          try {
            const { DashboardServer } = await import("./dashboard-server.js");
            this.dashboardServer = new DashboardServer({
              port: Number(process.env.QLING_DASHBOARD_PORT) || 9999,
              collector: this.metricsCollector,
              workflowRuntime: this.workflowRuntime,
              agentLoop: this,
            });
            await this.dashboardServer.start();
          } catch (serverErr: any) {
            console.warn(`⚠️ Dashboard 启动跳过: ${serverErr.message}`);
            this.dashboardServer = null;
          }
        }
      } catch (err) {
        console.error("[Metrics/Dashboard] init failed: " + (err as Error).message);
      }
    }

    // MCP initialization
    const mcpServersRaw = process.env.QLING_MCP_SERVERS;
    if (mcpServersRaw) {
      try {
        const mcpConnTimeoutRaw = Number(process.env.QLING_MCP_CONNECTION_TIMEOUT_MS ?? "10000");
        const mcpCallTimeoutRaw = Number(process.env.QLING_MCP_CALL_TIMEOUT_MS ?? "30000");
        const mcpConnTimeout =
          Number.isFinite(mcpConnTimeoutRaw) && mcpConnTimeoutRaw > 0 ? mcpConnTimeoutRaw : 10000;
        const mcpCallTimeout =
          Number.isFinite(mcpCallTimeoutRaw) && mcpCallTimeoutRaw > 0 ? mcpCallTimeoutRaw : 30000;
        const servers = JSON.parse(mcpServersRaw) as Record<string, MCPServerConfig>;
        const enabled = Object.values(servers).filter((s) => s.enabled);
        if (enabled.length > 0) {
          this.mcpRegistry = new MCPRegistry({
            connection: mcpConnTimeout,
            call: mcpCallTimeout,
          });
          for (const s of enabled) {
            this.mcpRegistry.registerServer(s);
          }
          setMCPRegistry(this.mcpRegistry);
          const results = await this.mcpRegistry.connectAll();
          const mcpTools = mcpToolsToNativeDefinitions(this.mcpRegistry.getAllTools());
          if (mcpTools.length > 0) {
            this.config.tools = [...this.config.tools, ...mcpTools];
            console.error("[MCP] Connected " + results.filter((r) => r.status === "connected").length + " servers, " + mcpTools.length + " tools");
          }
        }
      } catch (err) {
        console.error("[MCP] Init failed: " + (err as Error).message);
      }
    }

    // Skills section registration
    try {
      const skillDirs = getSkillDirs();
      const skills = await listSkills(skillDirs);
      this.sectionRegistry.register(buildSkillsSection(skills));
    } catch {
      // ignore
    }

    // Guard M2: content filter custom patterns
    if (this.guardConfig.content_filter?.custom_patterns?.length > 0) {
      setCustomPatterns(this.guardConfig.content_filter.custom_patterns);
    }
  }

  // --- Public API ---

  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
    this.knowledgeAdapter.onUserMessage(content);
  }

  async run(): Promise<string> {
    await this.initPromise;
    return runOuterAgentLoop({
      sessionId: this.sessionId,
      activeRun: this.activeRun,
      messages: this.messages,
      executionEventBus: this.executionEventBus,
      recoveryController: this.recoveryController,
      emit: (event, ...args) => this.emit(event, ...args),
      getRecoveryState: () => this.getRecoveryState(),
      formatRecoveryPause: (reason, next) => this.formatRecoveryPause(reason, next),
      applyRecoveryStrategy: (failure, strategy) => this.applyRecoveryStrategy(failure, strategy),
      setActiveRun: (run) => {
        this.activeRun = run;
      },
      executeInner: () => this.executeRunInternal(),
    });
  }

  private async executeRunInternal(): Promise<string> {
    await this.initPromise;
    const counters: TokenCounters = {
      sessionTokens: this.sessionTokens,
      sessionPromptTokens: this.sessionPromptTokens,
      sessionCompletionTokens: this.sessionCompletionTokens,
      tokenUsageSource: this.tokenUsageSource,
    };
    const host = {
      messages: this.messages,
      turnCount: this.turnCount,
      sessionId: this.sessionId,
      maxIterations: this.config.maxIterations,
      toolRepeatLimit: Math.max(1, this.config.runtime?.toolRepeatLimit ?? 6),
      parseRetries: this.config.runtime?.parseRetries ?? 0,
      verificationCommand: this.verificationCommand,
      counters,
      compactionCount: this.compactionCount,
      toolCallTotal: this.toolCallTotal,
      toolFailureTotal: this.toolFailureTotal,
      retryCountTotal: this.retryCountTotal,
      loggingFormat: this.loggingConfig.format as "text" | "json",
      activeRunId: this.activeRun?.runId,
      compactor: this.compactor,
      pipeline: this.pipeline,
      tools: this.config.tools,
      guardConfig: this.guardConfig,
      channel: this.channel,
      approvalGate: this.approvalGate,
      knowledgeAdapter: this.knowledgeAdapter,
      memoryStore: this.memoryStore,
      workspaceDir: this.config.runtime?.workspaceDir || process.cwd(),
      workflowRuntime: this.workflowRuntime,
      executionEventBus: this.executionEventBus,
      recoveryController: this.recoveryController,
      verifier: this.verifier,
      buildSystemPrompt: () => this.buildSystemPrompt(),
      chat: (systemPrompt: string, overrides?: Record<string, unknown>) =>
        this.chat(systemPrompt, overrides ?? {}),
      emit: (event: string, ...args: unknown[]) => this.emit(event, ...args),
      runVerificationCommand: (cmd: string) => this.runVerificationCommand(cmd),
      getRecoveryState: () => this.getRecoveryState(),
      reflectiveThink: (tc: ToolCall) => this.reflectiveThink(tc),
      checkAutoDream: () => this.checkAutoDream(),
    };
    const result = await runInnerIterationLoop(host);
    // write back mutable counters from host
    this.turnCount = host.turnCount;
    this.sessionTokens = host.counters.sessionTokens;
    this.sessionPromptTokens = host.counters.sessionPromptTokens;
    this.sessionCompletionTokens = host.counters.sessionCompletionTokens;
    this.tokenUsageSource = host.counters.tokenUsageSource;
    this.compactionCount = host.compactionCount;
    this.toolCallTotal = host.toolCallTotal;
    this.toolFailureTotal = host.toolFailureTotal;
    return result;
  }

  private formatRecoveryPause(reason: string, next: string): string {
    return formatRecoveryPause({
      reason,
      next,
      state: this.getRecoveryState(),
      verificationStagesSummary: this.getVerificationStagesSummary(),
    });
  }

  private async applyRecoveryStrategy(
    failure: { category: string; message: string },
    strategy?: string
  ): Promise<void> {
    if (strategy === "compact_context_once") {
      const result = await this.compactSessionNow();
      this.messages.push({
        role: "user",
        content:
          formatRecoveryInstruction(failure, strategy) +
          `\n上下文压缩结果: before=${result.beforeCount} after=${result.afterCount} changed=${result.changed}`,
      });
      return;
    }
    this.messages.push({
      role: "user",
      content: formatRecoveryInstruction(failure, strategy),
    });
  }

  getModel(): string {
    return this.config.model;
  }

  getProvider(): string {
    return this.config.provider ?? "unknown";
  }

  getEndpoint(): string {
    return this.config.endpoint ?? "";
  }

  setModel(model: string): void {
    this.applyLlmSession({ model });
  }

  /**
   * 进程内切换 LLM 会话态（model / provider / endpoint / apiKey）。
   * 默认不写盘；同步更新 QLING_LLM_* 环境变量以便后续子组件读取。
   */
  applyLlmSession(patch: LlmSessionPatch): { provider: string; endpoint: string; model: string } {
    if (typeof patch.provider === "string" && patch.provider.trim()) {
      this.config.provider = patch.provider.trim();
      process.env.QLING_LLM_PROVIDER = this.config.provider;
    }
    if (typeof patch.endpoint === "string" && patch.endpoint.trim()) {
      this.config.endpoint = patch.endpoint.trim();
      process.env.QLING_LLM_ENDPOINT = this.config.endpoint;
    }
    if (typeof patch.model === "string" && patch.model.trim()) {
      this.config.model = patch.model.trim();
      process.env.QLING_LLM_MODEL = this.config.model;
      this.compactor = new ContextCompactor(6000, this.config.model);
      this.verifier = new VerificationAgent(this.config.apiKey, this.config.model);
    }
    if (typeof patch.apiKey === "string") {
      const nextKey = resolveSessionApiKey(
        patch.apiKey,
        this.config.endpoint ?? "",
        this.config.provider ?? ""
      );
      if (nextKey) {
        this.config.apiKey = nextKey;
      }
    } else {
      // endpoint/provider 切到本地时，若当前 key 为空则填占位
      const ensured = resolveSessionApiKey(
        this.config.apiKey ?? "",
        this.config.endpoint ?? "",
        this.config.provider ?? ""
      );
      if (ensured) this.config.apiKey = ensured;
    }

    // Keep HTTP client in sync with session endpoint / key
    this.llmClient.reconfigure({
      endpoint: this.config.endpoint ?? "",
      apiKey: this.config.apiKey,
      timeoutMs: this.resolveLlmRequestTimeout(),
      provider: this.config.provider,
      onRetry: () => {
        this.retryCountTotal++;
      },
    });

    return {
      provider: this.config.provider ?? "unknown",
      endpoint: this.config.endpoint ?? "",
      model: this.config.model,
    };
  }

  getToolCount(): number {
    return this.config.tools.length;
  }

  reset(): void {
    this.messages = [];
    this.turnCount = 0;
    this.sessionTokens = 0;
    this.sessionPromptTokens = 0;
    this.sessionCompletionTokens = 0;
    this.tokenUsageSource = "unknown";
    this.memoryStore.resetSession();
    this.sectionRegistry.clearCache();
  }

  setChannel(channel: Channel): void {
    this.channel = channel;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getPermissionMode(): "allow" | "deny" | "ask" {
    return this.hookManager.getPermissionDefaultDecision();
  }

  setPermissionMode(mode: "allow" | "deny" | "ask"): void {
    this.hookManager.setPermissionDefaultDecision(mode);
    this.guardConfig.permissions.default = mode;
    process.env.QLING_GUARD_PERMISSIONS_DEFAULT = mode;
  }

  isPlanMode(): boolean {
    return this.hookManager.isPlanMode();
  }

  setPlanMode(enabled: boolean): void {
    this.hookManager.setPlanMode(enabled);
    process.env.QLING_PLAN_MODE = enabled ? "1" : "0";
  }

  getSessionMode(): "agent" | "plan" {
    return this.isPlanMode() ? "plan" : "agent";
  }

  async compactSessionNow(): Promise<{ beforeCount: number; afterCount: number; changed: boolean }> {
    const beforeCount = this.messages.length;
    const compacted = await this.compactor.compact(this.messages);
    const changed = compacted.length !== beforeCount;
    this.messages = compacted;
    if (changed) {
      this.compactionCount++;
    }
    this.memoryStore.compactPersisted(this.memoryMaxEntries);
    return {
      beforeCount,
      afterCount: this.messages.length,
      changed,
    };
  }

  async shutdown(): Promise<void> {
    try {
      await this.initPromise;
    } catch {
      // ignore init failure in shutdown path
    }
    this.approvalGate.cancelAll();
    if (this.metricsCollector && this.metricsFlushTimer) {
      this.metricsCollector.stopAutoFlush(this.metricsFlushTimer);
      this.metricsFlushTimer = null;
    }
    if (this.telemetry) {
      this.telemetry.recordSessionEnd();
      await this.telemetry.flush();
    }
    if (this.metricsCollector) {
      const retentionDays = Number(process.env.QLING_METRICS_RETENTION_DAYS ?? "30");
      if (retentionDays > 0) {
        await this.metricsCollector.purgeOldEntries(retentionDays);
      }
    }
    if (this.channel) {
      await this.channel.stop();
    }
    if (this.mcpRegistry) {
      await this.mcpRegistry.disconnectAll();
    }
    if (this.dashboardServer) {
      this.dashboardServer.stop();
    }
    try {
      if (this.messages.length > 0) {
        await this.linkSessionGraph();
      }
    } catch (err) {
      console.error("[Memory] linkSessionGraph error:", err);
    }
    await this.memoryStore.shutdown();
    if (this.wal) {
      await this.wal.close();
    }
  }

  private async linkSessionGraph(): Promise<void> {
    try {
      const cognitiveIndex = this.memoryStore.getCognitiveIndex();
      if (!cognitiveIndex) return;

      const sessionId = this.sessionId;
      let summary = "无摘要会话";
      if (this.memoryDreamLLMEnabled && this.messages.length > 0 && this.config.apiKey) {
        try {
          const axios = (await import("axios")).default;
          const userMessages = this.messages.filter(m => m.role === "user").map(m => m.content);
          const brief = userMessages.join("; ").slice(0, 500);
          const resp = await axios.post(
            this.config.endpoint + "/chat/completions",
            {
              model: this.config.model,
              messages: [
                { role: "system", content: "你是一个会话摘要助手。请为用户的请求写一句极为简洁的中文总结（不超过20字，例如：修复多行换行渲染与退出超时bug）。只输出总结文本，不要其他内容。" },
                { role: "user", content: brief },
              ],
              max_tokens: 60,
              temperature: 0.3,
            },
            {
              headers: {
                Authorization: "Bearer " + this.config.apiKey,
                "Content-Type": "application/json",
              },
              timeout: 10_000,
            }
          );
          const content = resp.data.choices?.[0]?.message?.content?.trim();
          if (content) {
            summary = content;
          }
        } catch (err) {
          summary = "执行了 " + this.turnCount + " 轮交互的任务";
        }
      } else {
        summary = "执行了 " + this.turnCount + " 轮交互的任务";
      }

      const fileRegex = /[/\w-]+\.(?:ts|js|py|md|json|yml|yaml|sh|mjs)/g;
      const files = new Set<string>();
      for (const msg of this.messages) {
        let match;
        while ((match = fileRegex.exec(msg.content)) !== null) {
          files.add(match[0]);
        }
      }

      const userMessages = this.messages.filter(m => m.role === "user").map(m => m.content);
      const tasks: string[] = [];
      if (userMessages.length > 0) {
        tasks.push(userMessages[0].slice(0, 50));
      }

      this.memoryStore.linkSessionToEntities(sessionId, summary, Array.from(files), tasks);
      console.error(`[Memory] 已建立会话图谱关系链: ${summary} (关联了 ${files.size} 个文件, ${tasks.length} 个任务)`);
    } catch (err) {
      console.error("[Memory] linkSessionGraph failed:", (err as Error).message);
    }
  }

  // --- Session Persistence ---

  async checkpointSession(): Promise<string> {
    return this.sessionRegistry.save(this.captureSessionSnapshot(this.sessionId));
  }

  async saveSession(name?: string): Promise<string> {
    const sessionName = name ?? defaultSessionSaveName();
    return this.sessionRegistry.save(this.captureSessionSnapshot(sessionName));
  }

  async loadSession(name: string): Promise<boolean> {
    return (await this.restoreSession(name)) !== null;
  }

  async listSessions(): Promise<string[]> {
    const sessions = await this.listSessionsDetailed();
    return sessions.map((session) => `${session.name}.json`);
  }

  async listSessionsDetailed(): Promise<SavedSessionSummary[]> {
    return this.sessionRegistry.list();
  }

  async restoreSession(nameOrSessionId: string): Promise<SavedSessionSummary | null> {
    const snapshot = await this.sessionRegistry.load(nameOrSessionId);
    if (!snapshot) {
      return null;
    }
    return this.hydrateSessionSnapshot(snapshot);
  }

  async restoreLatestSession(): Promise<SavedSessionSummary | null> {
    const snapshot = await this.sessionRegistry.loadLatest();
    if (!snapshot) {
      return null;
    }
    return this.hydrateSessionSnapshot(snapshot);
  }


  // --- Private Methods ---

  private captureSessionSnapshot(name: string): Omit<SavedSessionSnapshot, "version"> {
    return buildSessionSnapshot(name, {
      sessionId: this.sessionId,
      sessionCreatedAt: this.sessionCreatedAt,
      messages: this.getMessagesSnapshot(),
      turnCount: this.turnCount,
      sessionTokens: this.sessionTokens,
      compactionCount: this.compactionCount,
      workspaceDir: this.getWorkspaceDir(),
    });
  }

  private hydrateSessionSnapshot(snapshot: SavedSessionSnapshot): SavedSessionSummary {
    const patch = applySessionSnapshot(snapshot);
    this.messages = patch.messages;
    this.turnCount = patch.turnCount;
    this.sessionTokens = patch.sessionTokens;
    this.sessionPromptTokens = patch.sessionPromptTokens;
    this.sessionCompletionTokens = patch.sessionCompletionTokens;
    this.tokenUsageSource = patch.tokenUsageSource;
    this.compactionCount = patch.compactionCount;
    this.sessionId = patch.sessionId;
    this.sessionCreatedAt = patch.sessionCreatedAt;
    this.pipeline.setSessionId(this.sessionId);
    this.memoryStore.resetSession();
    this.sectionRegistry.clearCache();
    if (this.config.runtime) {
      this.config = {
        ...this.config,
        runtime: {
          ...this.config.runtime,
          workspaceDir: patch.workspaceDir ?? this.config.runtime.workspaceDir,
        },
      };
    }
    return patch.summary;
  }

  /** 自我反思循环 (v0.5 M2) */
  private async reflectiveThink(tc: ToolCall) {
    return reflectiveThink(tc, (systemPrompt, overrides) => this.chat(systemPrompt, overrides ?? {}));
  }

  private async buildSystemPrompt(): Promise<string> {
    return assembleSystemPrompt({
      baseSystemPrompt: this.config.systemPrompt,
      sectionRegistry: this.sectionRegistry,
      memoryStore: this.memoryStore,
      messages: this.messages,
      provider: this.config.provider,
      endpoint: this.config.endpoint,
      workspaceDir: this.config.runtime?.workspaceDir,
      fileCacheDir: this.config.runtime?.fileCacheDir,
      fileStateDir: this.config.runtime?.fileStateDir,
      runtimeRootDir: this.runtimeRootDir,
    });
  }

  private async chat(systemPrompt: string, overrides: Record<string, any> = {}): Promise<LlmChatResponse> {
    await this.maybeDumpInspect("prompt", {
      turn: this.turnCount,
      model: this.config.model,
      runtime: this.config.runtime ?? null,
      prompt: systemPrompt,
    });
    await this.maybeDumpInspect("request", {
      model: this.config.model,
      systemPrompt,
      messageCount: this.messages.length,
      toolCount: this.config.tools.length,
      overrides,
    });

    return this.llmClient.chatCompletions({
      model: this.config.model,
      systemPrompt,
      messages: this.messages,
      tools: this.config.tools,
      overrides,
    });
  }

  /** Exposed for doctor / status: current staged verification plan. */
  getVerificationStagesSummary(): string {
    return stagesSummary(this.verificationCommand);
  }

  async persistVerificationCommand(): Promise<void> {
    await persistVerificationCommandFile(this.getWorkspaceDir(), this.verificationCommand);
  }

  async loadVerificationCommand(): Promise<void> {
    this.verificationCommand = await loadVerificationCommandFile(this.getWorkspaceDir());
  }

  runVerificationCommand(cmd: string): Promise<{ code: number; stdout: string; stderr: string }> {
    return runShellCommand(cmd, this.getWorkspaceDir());
  }

  private async checkAutoDream(): Promise<void> {
    try {
      const changedCount = await runAutoDream({
        messages: this.messages,
        turnCount: this.turnCount,
        memoryStore: this.memoryStore,
        memoryDreamLLMEnabled: this.memoryDreamLLMEnabled,
        memoryDreamTurnThreshold: this.memoryDreamTurnThreshold,
        memoryMaxEntries: this.memoryMaxEntries,
        model: this.config.model,
        apiKey: this.config.apiKey,
        endpoint: this.config.endpoint ?? "https://api.deepseek.com",
      });
      if (changedCount > 0) {
        console.error("[AutoDream] " + changedCount + " 项长期记忆已整理并保存");
      }
    } catch {
      // ignore
    }
  }

  private async maybeDumpInspect(kind: "prompt" | "request", payload: unknown): Promise<void> {
    if (kind === "prompt" && !this.loggingConfig.inspectPrompt) return;
    if (kind === "request" && !this.loggingConfig.inspectRequest) return;
    try {
      const file = path.join(
        this.loggingConfig.inspectDumpDir,
        `${String(this.turnCount).padStart(4, "0")}_${Date.now()}_${kind}.json`
      );
      await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf-8");
    } catch {
      // inspect dump failure should not block execution
    }
  }

  private resolveLlmRequestTimeout(): number {
    const envValue = Number(process.env.QLING_LLM_REQUEST_TIMEOUT_MS ?? "120000");
    if (Number.isFinite(envValue) && envValue > 0) {
      return envValue;
    }
    return this.config.runtime?.timeoutMs ?? 120_000;
  }

}
