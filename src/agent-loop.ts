// ============================================================
// 轻灵 - Agent Loop v2（整合 Pipeline Hook + Section Prompt）
// Token 计数仅采用 provider 官方 usage 字段。
// ============================================================

import axios from "axios";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { exec } from "child_process";
import { existsSync } from "fs";
import { dispatch, ALL_TOOLS, setMCPRegistry } from "./tools/index.js";
import { HookManager, ToolPipeline } from "./pipeline/hooks.js";
import { buildDefaultRegistry, buildSystemPrompt, buildRepoMapSection } from "./pipeline/sections.js";
import { MemoryStore, extractDreamMemories } from "./memory.js";
import {
  extractProviderUsage,
  resolveRoundTokenUsage,
  type ChatUsage,
  type TokenUsageSource,
} from "./token-usage.js";
import { WriteAheadLog } from "./memory/wal.js";
import { extractDreamMemoriesLLM } from "./memory/memory-llm-dream.js";
import { MCPRegistry } from "./mcp/registry.js";
import { mcpToolsToNativeDefinitions } from "./mcp/bridge.js";
import { ApprovalGate, ApprovalRequiredError } from "./guard/approval.js";
import { MetricsCollector } from "./metrics/collector.js";
import { AgentTelemetry } from "./metrics/agent-telemetry.js";
import type { Channel } from "./channels/types.js";
import type { MCPServerConfig } from "./types.js";
import { VerificationAgent } from "./pipeline/verification.js";
import { ContextCompactor } from "./context-compactor.js";
import { KnowledgeAgentAdapter } from "./knowledge-agent.js";
import type { AgentConfig, Message, RawToolCall, ToolCall, ToolResult } from "./types.js";
import { WorkflowRuntime } from "./workflow-runtime.js";
import { WorkflowBuilder } from "./workflow-types.js";
import { checkToolConsistency } from "./pipeline/consistency-checker.js";
import { DashboardServer } from "./dashboard-server.js";
import { DiscoveryRegistry } from "./discovery-registry.js";
import { DiscoverySource } from "./discovery-types.js";
import { MissionManager } from "./mission/manager.js";
import { getSkillDirs } from "./tools/skill.js";
import { listSkills } from "./skills/registry.js";
import { buildSkillsSection } from "./pipeline/sections.js";
import { applyContentFilter, setCustomPatterns } from "./guard/content-filter.js";
import { appendGuardAudit } from "./guard.js";
import { guardConfigFromEnv, type GuardConfig } from "./config.js";
import {
  SessionRegistry,
  type SavedSessionSnapshot,
  type SavedSessionSummary,
} from "./session/session-registry.js";
import {
  apiKeyRequiredForEndpoint,
  isLoopbackEndpoint,
} from "./providers/presets.js";
import { maybeAutoCommitAfterWrite } from "./git/auto-commit.js";
import {
  prepareToolResultContent,
  resolveToolResultMaxChars,
} from "./context-tool-hygiene.js";
import { ExecutionEventBus } from "./execution/event-bus.js";
import { classifyFailure } from "./execution/failure-classifier.js";
import { RecoveryController } from "./execution/recovery-controller.js";
import { RunTraceStore } from "./execution/run-trace-store.js";
import type { ExecutionEvent, RecoveryState } from "./execution/types.js";
import { StagedVerifier } from "./execution/staged-verifier.js";
import { createHash } from "node:crypto";

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

interface TurnTelemetry {
  turn: number;
  toolCalls: number;
  toolFailures: number;
}

interface ChatResponse {
  content: string;
  tool_calls?: RawToolCall[];
  usage?: ChatUsage;
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
  private client: ReturnType<typeof axios.create>;
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
  private dashboardServer: DashboardServer | null = null;
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
    if (action === "cancel" && this.activeRun) {
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

    // HTTP client + retry interceptor
    this.client = axios.create({
      baseURL: endpoint,
      headers: {
        Authorization: "Bearer " + this.config.apiKey,
        "Content-Type": "application/json",
      },
      timeout: this.resolveLlmRequestTimeout(),
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (err) => {
        const cfg = err.config;
        const maxRetries = 3;
        cfg.__retryCount = cfg.__retryCount ?? 0;
        // 只在 429 / 500-503 / ECONNRESET / ETIMEDOUT 时重试
        const status = err.response?.status;
        const shouldRetry =
          (!err.response || status === 429 || (status >= 500 && status <= 503)) &&
          cfg.__retryCount < maxRetries;
        if (shouldRetry) {
          cfg.__retryCount++;
          this.retryCountTotal++;
          const delay = Math.min(1000 * Math.pow(2, cfg.__retryCount - 1), 10_000);
          await new Promise((r) => setTimeout(r, delay));
          return this.client(cfg);
        }
        return Promise.reject(err);
      }
    );

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

        // v0.3 Dashboard Server
        if (dashboardEnabled) {
          this.dashboardServer = new DashboardServer({
            port: Number(process.env.QLING_DASHBOARD_PORT) || 9999,
            collector: this.metricsCollector,
            workflowRuntime: this.workflowRuntime,
            agentLoop: this,
          });
          try {
            await this.dashboardServer.start();
          } catch (serverErr: any) {
            console.warn(`⚠️ Dashboard 启动跳过: ${serverErr.message}`);
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
    const resumable = this.activeRun && this.getRecoveryState()?.status === "recovering";
    const originalTask = resumable ? this.activeRun!.originalTask : this.findLastUserMessage();
    const runId = resumable
      ? this.activeRun!.runId
      : `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    if (!resumable) {
      this.activeRun = { runId, sessionId: this.sessionId, originalTask, startedAt: Date.now() };
      this.recoveryController.startRun({ runId, sessionId: this.sessionId, originalTask });
      this.executionEventBus.startRun({ runId, sessionId: this.sessionId });
    }
    let transportAttempts = 0;

    while (true) {
      try {
        const response = await this.executeRunInternal();
        if (this.getRecoveryState()?.status === "paused") return response;
        this.executionEventBus.completeRun(runId, "succeeded");
        this.activeRun = null;
        return response;
      } catch (error) {
        this.executionEventBus.completeAttempt(runId, "failed");
        const failure = classifyFailure(error, { provider: true });
        if (failure.category === "provider_transient" && transportAttempts < 3) {
          transportAttempts++;
          const delay = Math.min(4_000, 250 * 2 ** (transportAttempts - 1)) + Math.floor(Math.random() * 100);
          this.executionEventBus.emit({
            runId,
            sessionId: this.sessionId,
            type: "recovery_started",
            status: "recovering",
            stage: "provider",
            category: failure.category,
            fingerprint: failure.fingerprint,
            recoveryAction: "transport_retry",
          });
          this.emit("repair", failure.message, "provider transport retry", transportAttempts);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        const decision = this.recoveryController.recordFailure(failure, {});
        this.executionEventBus.emit({
          runId,
          sessionId: this.sessionId,
          type: "failure",
          status: decision.action === "pause" ? "paused" : "recovering",
          stage: "agent",
          category: decision.category,
          fingerprint: failure.fingerprint,
          recoveryAction: decision.action,
        });
        this.emit("recovery_paused", this.recoveryController.getRecoveryState(), decision);
        if (decision.action === "pause") return this.formatRecoveryPause(failure.message, decision.reason);
        this.emit("repair", failure.message, decision.reason, this.recoveryController.getRecoveryState().strategyAttempts);
        continue;
      }
    }
  }

  private async executeRunInternal(): Promise<string> {
    await this.initPromise;
    const toolSignatureCounts = new Map<string, number>();
    const toolRepeatLimit = Math.max(1, this.config.runtime?.toolRepeatLimit ?? 6);

    for (let i = 0; i < this.config.maxIterations; i++) {
      this.turnCount++;
      const runId = this.activeRun?.runId ?? `run_untracked_${this.turnCount}`;
      const attemptId = `attempt_${runId}_${this.turnCount}`;
      this.executionEventBus.startAttempt({ runId, sessionId: this.sessionId, attemptId });

      // 保存本轮用户消息（在 assistant/tool 消息 push 之前）
      let lastUserMsg = "";
      for (let k = this.messages.length - 1; k >= 0; k--) {
        if (this.messages[k].role === "user") {
          lastUserMsg = this.messages[k].content;
          break;
        }
      }

      // 0. 上下文压缩（超过阈值时触发）
      if (this.compactor.needsCompaction(this.messages)) {
        console.error("\n📦 上下文压缩中...（" + this.messages.length + " 条消息）");
        const compacted = await this.compactor.compact(this.messages);
        this.messages = compacted;
        this.compactionCount++;
        console.error("📦 压缩完成 → " + this.messages.length + " 条消息\n");
      }

      // 0b. 冲突/注入扫描（Lesson 12: Context Validation）
      const conflicts = this.compactor.scanConflicts(this.messages);
      if (conflicts.length > 0) {
        console.error("⚠️ 检测到 " + conflicts.length + " 处指令冲突");
      }
      const poison = this.compactor.scanPoison(this.messages);
      if (poison.length > 0) {
        console.error("🚨 检测到 " + poison.length + " 处可能的提示注入");
      }

      // 1. 构建 system prompt（动态sections）
      const systemPrompt = await this.buildSystemPrompt();

      // v0.3 Workflow Checkpoint: Update context
      if (process.env.QLING_FEATURES_WORKFLOW_RUNTIME === "true") {
        await this.workflowRuntime.updateContext(this.messages);
      }

      // 2. API 调用；token 仅累加 provider 官方 usage
      const { content, tool_calls, usage } = await this.chat(systemPrompt);
      const tokenUsage = resolveRoundTokenUsage(usage);
      if (tokenUsage.source === "provider") {
        this.sessionTokens += tokenUsage.tokens;
        this.sessionPromptTokens += tokenUsage.promptTokens;
        this.sessionCompletionTokens += tokenUsage.completionTokens;
        this.tokenUsageSource = "provider";
      }
      this.messages.push({ role: "assistant", content, tool_calls });
      this.emit("thinking", content || "正在思考...");

      // 4. 无工具调用 → 结束
      if (!tool_calls || tool_calls.length === 0) {
        // 知识观察：助手消息
        this.knowledgeAdapter.onAssistantMessage(content);
        // Auto-dream 检查
        await this.checkAutoDream();
        // 知识观察：回合结束
        await this.knowledgeAdapter.onTurnEnd(this.turnCount);
        this.logTurnTelemetry({ turn: this.turnCount, toolCalls: 0, toolFailures: 0 });
        this.executionEventBus.completeAttempt(runId, "succeeded");
        return content;
      }

      // 5. Pipeline 执行（Hook → 工具）
      console.error("\n🔧 执行 " + tool_calls.length + " 个工具...\n");
      const preparedCalls: Array<{ call: ToolCall; immediateResult?: ToolResult }> = [];
      for (const tc of tool_calls) {
        const parseResult = this.parseToolArguments(tc.function.arguments);
        if (!parseResult.ok) {
          preparedCalls.push({
            call: {
              id: tc.id,
              name: tc.function.name,
              arguments: {},
            },
            immediateResult: {
              tool_call_id: tc.id,
              output: `Error: [TOOL_INVALID_ARGUMENTS] ${parseResult.error}`,
              is_error: true,
              error: {
                code: "TOOL_INVALID_ARGUMENTS",
                message: parseResult.error,
                category: "runtime",
              },
            },
          });
          continue;
        }

        const call: ToolCall = {
          id: tc.id,
          name: tc.function.name,
          arguments: parseResult.value,
        };
        const signature = this.buildToolSignature(call.name, call.arguments);
        const repeatCount = (toolSignatureCounts.get(signature) ?? 0) + 1;
        toolSignatureCounts.set(signature, repeatCount);
        if (repeatCount > toolRepeatLimit) {
          preparedCalls.push({
            call,
            immediateResult: {
              tool_call_id: tc.id,
              output:
                `Error: [TOOL_REPEAT_LIMIT_EXCEEDED] ` +
                `tool '${call.name}' exceeded repeat limit (${toolRepeatLimit})`,
              is_error: true,
              error: {
                code: "TOOL_REPEAT_LIMIT_EXCEEDED",
                message: `tool '${call.name}' exceeded repeat limit (${toolRepeatLimit})`,
                category: "guard",
              },
            },
          });
          continue;
        }
        preparedCalls.push({ call });
      }

      // v0.3 Workflow Checkpoint: Set pending tools
      if (process.env.QLING_FEATURES_WORKFLOW_RUNTIME === "true") {
        await this.workflowRuntime.setPendingTools(preparedCalls.map(p => p.call));
      }

      let turnToolCalls = 0;
      let turnToolFailures = 0;

      for (let j = 0; j < preparedCalls.length; j++) {
        const prepared = preparedCalls[j];
        const tc = prepared.call;
        turnToolCalls++;

        // v0.5 M2: Self-Reflective Loop (Inner Monologue)
        // 针对高风险工具进行预演评估
        if (tc.name === "write" || tc.name === "bash") {
          const reflection = await this.reflectiveThink(tc);
          if (reflection.decision === "block") {
            console.error(`🚨 [内省阻断] ${reflection.reason}`);
            this.messages.push({
              role: "tool",
              content: JSON.stringify({
                tool_call_id: tc.id,
                output: `Error: [REFLECTION_BLOCKED] ${reflection.reason}. This action was deemed too risky.`,
                is_error: true,
              }),
              tool_call_id: tc.id,
            });
            turnToolFailures++;
            continue;
          } else if (reflection.decision === "warn") {
            console.error(`💭 [内省警告] ${reflection.reason}`);
          }
        }

        // v0.3 Tool Spec Boost: Consistency Check
        if (process.env.QLING_FEATURES_TOOL_SPEC_BOOST === "true") {
          const def = this.config.tools.find(t => t.name === tc.name);
          if (def) {
            const check = checkToolConsistency(tc, def);
            if (!check.ok) {
              console.error(`⚠️ [SpecBoost] 检查到幻觉风险: ${tc.name} - ${check.error}`);
              this.messages.push({
                role: "tool",
                content: JSON.stringify({
                  tool_call_id: tc.id,
                  output: `Error: [TOOL_SPEC_VIOLATION] ${check.error}. Please correct your arguments based on the schema and examples.`,
                  is_error: true,
                }),
                tool_call_id: tc.id,
              });
              turnToolFailures++;
              continue;
            }
            if (check.warnings.length > 0) {
               console.warn(`[SpecBoost] 潜在警告: ${check.warnings.join("; ")}`);
            }
          }
        }

        // 知识观察：工具调用前
        this.knowledgeAdapter.onToolCall(tc);
        this.executionEventBus.startTool({ runId, attemptId, toolCallId: tc.id, tool: tc.name });
        this.emit("tool_start", tc.name, tc.arguments);
        let result: ToolResult = prepared.immediateResult ?? {
          tool_call_id: tc.id,
          output: "",
          is_error: false,
        };
        if (!prepared.immediateResult) {
          try {
            result = await this.pipeline.execute(tc, (t) => dispatch(t));
          } catch (err) {
            if (err instanceof ApprovalRequiredError && this.channel) {
              // Approval flow
              if (process.env.QLING_FEATURES_WORKFLOW_RUNTIME === "true") {
                await this.workflowRuntime.awaitApproval();
              }
              const approvalResponse = await this.approvalGate.requestApproval(
                {
                  id: err.toolCallId,
                  toolName: err.toolName,
                  arguments: tc.arguments as Record<string, unknown>,
                  reason: err.reasons.join("; "),
                  timestamp: Date.now(),
                },
                this.channel
              );
              if (approvalResponse.decision === "allow") {
                result = await dispatch(tc);
              } else {
                result = {
                  tool_call_id: tc.id,
                  output: "[Approval Denied] " + err.reasons.join("; "),
                  is_error: true,
                  error: { code: "APPROVAL_DENIED", message: "User denied tool execution", category: "permission" },
                };
                turnToolFailures++;
              }
            } else {
              result = {
                tool_call_id: tc.id,
                output: (err as Error).message,
                is_error: true,
                error: { code: "TOOL_ERROR", message: (err as Error).message, category: "runtime" },
              };
              turnToolFailures++;
            }
          }
        } else {
          turnToolFailures++;
        }
        // 知识观察：工具结果后
        this.knowledgeAdapter.onToolResult(result, tc.name);
        this.executionEventBus.completeTool({ runId, attemptId, toolCallId: tc.id, tool: tc.name, failed: result.is_error });
        this.emit("tool_result", tc.name, result.output, result.is_error ?? false);

        // v0.5 M1: Knowledge Graph Linking (Automatic)
        if (!result.is_error && (tc.name === "bash" || tc.name === "write" || tc.name === "read")) {
          let lastUserMsg = "";
          for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === "user") {
              lastUserMsg = this.messages[i].content;
              break;
            }
          }
          const taskId = "task_" + Buffer.from(lastUserMsg.slice(0, 10)).toString("hex");

          this.memoryStore.link(
            { id: taskId, type: "task", label: lastUserMsg.slice(0, 50) },
            "uses",
            { id: "tool_" + tc.name, type: "tool", label: tc.name }
          );

          const args = tc.arguments as any;
          const targetFile = args.path || args.file || "";
          if (targetFile) {
            this.memoryStore.link(
              { id: "tool_" + tc.name, type: "tool", label: tc.name },
              tc.name === "read" ? "reads" : "writes",
              { id: "file_" + Buffer.from(targetFile).toString("hex"), type: "file", label: targetFile }
            );
          }
        }

        // Phase 1.2: 可选 git auto-commit（write/patch 成功且非 dry_run）
        if (
          !result.is_error &&
          (tc.name === "write" || tc.name === "patch") &&
          !(tc.arguments as { dry_run?: boolean })?.dry_run
        ) {
          const args = tc.arguments as { path?: string; file?: string };
          const targetFile = String(args.path || args.file || "").trim();
          if (targetFile) {
            try {
              const ac = await maybeAutoCommitAfterWrite({
                workspaceDir: this.config.runtime?.workspaceDir || process.cwd(),
                filePath: targetFile,
                toolName: tc.name,
              });
              if (ac.mode !== "off") {
                result = {
                  ...result,
                  output: `${result.output}\n\n[${ac.message}]`,
                };
              }
            } catch {
              // auto-commit 失败不影响工具成功语义
            }
          }
        }

        // Guard M2: 内容过滤（工具输出）
        if (this.guardConfig.enabled && this.guardConfig.content_filter?.enabled) {
          const cf = applyContentFilter(result.output, {
            pii: this.guardConfig.content_filter.pii_detection,
            injection: this.guardConfig.content_filter.injection_detection,
            custom: this.guardConfig.content_filter.custom_patterns.length > 0,
          });
          if (cf.blocked) {
            await appendGuardAudit(this.guardConfig, {
              tool: tc.name,
              action: "deny",
              category: "content_filter",
              reason: cf.reason,
            });
            result = {
              ...result,
              output: `[内容过滤] ${cf.reason}: ${(cf.matches ?? []).join(", ")}`,
              is_error: true,
              error: { code: "CONTENT_FILTERED", message: cf.reason ?? "content filtered", category: "guard" },
            };
            turnToolFailures++;
          }
        }
        // 进度展示
        const preview = result.output.split("\n")[0].slice(0, 80);
        const icon = result.is_error ? "❌" : "✅";
        console.error(icon + " " + tc.name + ": " + preview + (result.output.length > 80 ? "..." : ""));

        // v0.3 Workflow Checkpoint: Add result
        if (process.env.QLING_FEATURES_WORKFLOW_RUNTIME === "true") {
          await this.workflowRuntime.addToolResult(result);
        }

        // Phase 3.0: 工具结果入上下文前卫生处理（默认折叠超长 output）
        const rawToolContent = JSON.stringify(result);
        const hygienicContent = prepareToolResultContent(rawToolContent, {
          maxChars: resolveToolResultMaxChars(),
        });
        this.messages.push({
          role: "tool",
          content: hygienicContent,
          tool_call_id: tc.id,
        });
      }

      // 6. 验证阶段（针对写操作）
      const hasWrites = preparedCalls.some((t) => t.call.name === "write" || t.call.name === "patch" || t.call.name === "bash");
      if (hasWrites) {
        if (this.verificationCommand) {
          const stagedVerifier = new StagedVerifier({ execute: (command) => this.runVerificationCommand(command) });
          const verification = await stagedVerifier.run([{ name: "configured", command: this.verificationCommand }]);
          if (!verification.ok) {
            const failure = classifyFailure(new Error(`verification command failed: ${this.verificationCommand}`), {
              tool: "verify",
              verificationCommand: this.verificationCommand,
            });
            const progress = {
              diffHash: await this.getWorkspaceDiffHash(),
              failingTests: verification.failingTests,
            };
            const decision = this.recoveryController.recordFailure(failure, progress);
            const state = this.recoveryController.getRecoveryState();
            this.executionEventBus.emit({
              runId: state.runId,
              sessionId: state.sessionId,
              type: "verification_failed",
              status: decision.action === "pause" ? "paused" : "recovering",
              stage: verification.failedStage,
              tool: "verify",
              category: decision.category,
              fingerprint: failure.fingerprint,
              progress,
              recoveryAction: decision.action,
            });
            if (decision.action === "pause") {
              this.executionEventBus.completeAttempt(runId, "failed");
              this.emit("recovery_paused", state, decision);
              return this.formatRecoveryPause(verification.stderr || verification.stdout, decision.reason);
            }
            const stdout = verification.stdout.slice(-2_000);
            const stderr = verification.stderr.slice(-2_000);
            this.messages.push({
              role: "user",
              content: `【定向验证失败】阶段=${verification.failedStage} 命令=\`${this.verificationCommand}\`\n` +
                `失败测试=${verification.failingTests.join(", ") || "unknown"}\n[stdout]\n${stdout}\n[stderr]\n${stderr}\n` +
                "仅修复当前失败集合；不得重复无关的全量验证。",
            });
            this.emit("repair", failure.message, "targeted_verification_repair", state.strategyAttempts);
            this.executionEventBus.completeAttempt(runId, "recovering");
            continue;
          }
          this.emit("verification", "PASS", `验证通过: ${this.verificationCommand}`);
        } else {
          await this.verifyLastOperation();
        }
      }

      // 7. Auto-dream 检查
      await this.checkAutoDream();

      // v0.5 M1: Experience Distillation (M1 Core)
      if (this.turnCount > 0 && !preparedCalls.some(p => p.immediateResult?.is_error || (p.call.id && this.messages.some(m => m.tool_call_id === p.call.id && JSON.parse(m.content!).is_error)))) {
         const successfulCmds = preparedCalls
           .filter(p => p.call.name === "bash")
           .map(p => (p.call.arguments as any).cmd || (p.call.arguments as any).command);

         if (successfulCmds.length > 0) {
           let lastUserMsg = "";
           for (let i = this.messages.length - 1; i >= 0; i--) {
             if (this.messages[i].role === "user") {
               lastUserMsg = this.messages[i].content;
               break;
             }
           }
           this.memoryStore.addPractice(
             lastUserMsg.slice(0, 100),
             successfulCmds,
             preparedCalls.map(p => (p.call.arguments as any).path || (p.call.arguments as any).file).filter(Boolean)
           );
           console.error(`✨ [认知] 已将 ${successfulCmds.length} 条成功指令蒸馏为最佳实践`);
         }
      }

      // 7b. 记录对话轮次（更新 conversation memory）
      this.memoryStore.addConversationTurn("user", lastUserMsg);
      this.memoryStore.addConversationTurn("assistant", content);

      // 7c. 知识观察：助手消息 + 回合结束
      this.knowledgeAdapter.onAssistantMessage(content);
      await this.knowledgeAdapter.onTurnEnd(this.turnCount);
      this.logTurnTelemetry({
        turn: this.turnCount,
        toolCalls: turnToolCalls,
        toolFailures: turnToolFailures,
      });
      this.executionEventBus.completeAttempt(runId, "succeeded");
    }

    return "⚠️ 达到最大迭代次数，任务未完成。";
  }

  private findLastUserMessage(): string {
    for (let index = this.messages.length - 1; index >= 0; index--) {
      if (this.messages[index].role === "user") return this.messages[index].content;
    }
    return "";
  }

  private formatRecoveryPause(reason: string, next: string): string {
    return [
      "执行已暂停",
      `原因: ${reason}`,
      `已尝试: ${this.getRecoveryState()?.strategyAttempts ?? 0} 次恢复策略`,
      `当前证据: ${this.getRecoveryState()?.lastFailure?.fingerprint ?? "-"}`,
      `下一步: ${next}；使用 /recover retry|next|edit|cancel`,
      "边界: 本地摘要轨迹已保存，不包含 prompt 或工具正文。",
    ].join("\n");
  }

  private async getWorkspaceDiffHash(): Promise<string> {
    const result = await this.runVerificationCommand("git diff --no-ext-diff --binary");
    const content = result.code === 0 ? result.stdout : "git-unavailable";
    return createHash("sha256").update(content).digest("hex").slice(0, 20);
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
    return this.sessionRegistry.save(this.buildSessionSnapshot(this.sessionId));
  }

  async saveSession(name?: string): Promise<string> {
    const sessionName = name ?? "session-" + new Date().toISOString().replace(/[:.]/g, "-");
    return this.sessionRegistry.save(this.buildSessionSnapshot(sessionName));
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
    return this.applySessionSnapshot(snapshot);
  }

  async restoreLatestSession(): Promise<SavedSessionSummary | null> {
    const snapshot = await this.sessionRegistry.loadLatest();
    if (!snapshot) {
      return null;
    }
    return this.applySessionSnapshot(snapshot);
  }


  // --- Private Methods ---

  private buildSessionSnapshot(name: string): Omit<SavedSessionSnapshot, "version"> {
    return {
      name,
      sessionId: this.sessionId,
      workspaceDir: this.getWorkspaceDir(),
      createdAt: this.sessionCreatedAt,
      updatedAt: new Date().toISOString(),
      messages: this.getMessagesSnapshot(),
      turnCount: this.turnCount,
      sessionTokens: this.sessionTokens,
      compactionCount: this.compactionCount,
    };
  }

  private applySessionSnapshot(snapshot: SavedSessionSnapshot): SavedSessionSummary {
    this.messages = snapshot.messages.map((message) => ({ ...message }));
    this.turnCount = snapshot.turnCount;
    this.sessionTokens = snapshot.sessionTokens;
    this.sessionPromptTokens = 0;
    this.sessionCompletionTokens = 0;
    this.tokenUsageSource = "unknown";
    this.compactionCount = snapshot.compactionCount;
    this.sessionId = snapshot.sessionId;
    this.sessionCreatedAt = snapshot.createdAt;
    this.pipeline.setSessionId(this.sessionId);
    this.memoryStore.resetSession();
    this.sectionRegistry.clearCache();
    if (this.config.runtime) {
      this.config = {
        ...this.config,
        runtime: {
          ...this.config.runtime,
          workspaceDir: snapshot.workspaceDir ?? this.config.runtime.workspaceDir,
        },
      };
    }
    return {
      name: snapshot.name,
      sessionId: snapshot.sessionId,
      workspaceDir: snapshot.workspaceDir,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      turnCount: snapshot.turnCount,
      messageCount: snapshot.messages.length,
      sessionTokens: snapshot.sessionTokens,
      compactionCount: snapshot.compactionCount,
    };
  }

  /** 自我反思循环 (v0.5 M2) */
  private async reflectiveThink(tc: ToolCall): Promise<{ decision: "proceed" | "ask" | "block" | "warn", reason: string }> {
    const { buildReflectionPrompt } = await import("./pipeline/sections.js");
    const prompt = buildReflectionPrompt(tc.name, tc.arguments);

    try {
      // 执行一次极简的内部调用进行风险评估
      const resp = await this.chat(prompt, { max_tokens: 200, temperature: 0 });
      // 提取 JSON（防止模型输出冗余文字）
      const jsonStr = resp.content.match(/\{[\s\S]*\}/)?.[0] || "{}";
      const analysis = JSON.parse(jsonStr);
      return {
        decision: analysis.decision || "proceed",
        reason: analysis.reason || "评估完成。"
      };
    } catch {
      // 降级：启发式检查
      const args = tc.arguments as any;
      const cmd = (args.cmd || args.command || "").toLowerCase();
      if (cmd.includes("rm ") || cmd.includes("del ")) {
        return { decision: "warn", reason: "启发式拦截：检测到可能的删除操作。" };
      }
      return { decision: "proceed", reason: "启发式通过。" };
    }
  }

  private async buildSystemPrompt(): Promise<string> {
    // 加载代码地图并更新 REPOMAP section
    const cognitiveIndex = (this.memoryStore as any)?.getCognitiveIndex?.();
    if (cognitiveIndex) {
      try {
        const symbols = cognitiveIndex.getAllSymbols();
        this.sectionRegistry.register(buildRepoMapSection(symbols));
      } catch (err) {
        // Ignore
      }
    }

    // 加载记忆 (v0.3 支持语义异步预取)
    let memoryStr = "";
    if (this.messages.length > 0) {
       let lastUserMsg = "";
       for (let i = this.messages.length - 1; i >= 0; i--) {
         if (this.messages[i].role === "user") {
           lastUserMsg = this.messages[i].content;
           break;
         }
       }
       const relevant = await this.memoryStore.getRelevant(lastUserMsg, 10);
       if (relevant.length > 0) {
         memoryStr = relevant.map((e) => "[" + e.source + "] " + e.content).join("\n");
       }
    }

    const sectionPrompt = buildSystemPrompt(this.sectionRegistry, {
      memory: memoryStr || undefined,
    });
    const parts = [
      this.config.systemPrompt.trim(),
      this.buildRuntimeMetaSection(),
      sectionPrompt,
    ].filter((p) => p && p.trim().length > 0);
    return parts.join("\n\n");
  }

  private async chat(systemPrompt: string, overrides: Record<string, any> = {}): Promise<ChatResponse> {
    const systemMsg: Message = { role: "system", content: systemPrompt };
    const payload = {
      model: this.config.model,
      messages: [systemMsg, ...this.messages],
      tools: this.config.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      stream: false,
      ...overrides,
    };

    await this.maybeDumpInspect("prompt", {
      turn: this.turnCount,
      model: this.config.model,
      runtime: this.config.runtime ?? null,
      prompt: systemPrompt,
    });
    await this.maybeDumpInspect("request", payload);

    let resp;
    try {
      resp = await this.client.post("/chat/completions", payload);
    } catch (err) {
      const e = err as any;
      const detail = JSON.stringify(e.response?.data ?? {}).slice(0, 500);
      throw new Error(`${this.config.provider} API error: ` + detail);
    }

    const choice = resp.data.choices?.[0];
    if (!choice) throw new Error(`${this.config.provider} API error: ` + JSON.stringify(resp.data));

    const msg = choice.message;
    let rawToolCalls: RawToolCall[] | undefined;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      rawToolCalls = msg.tool_calls.map((tc: any) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments:
            typeof tc.function.arguments === "string"
              ? tc.function.arguments
              : JSON.stringify(tc.function.arguments),
        },
      }));
    }

    // 优先解析 data.usage；若无则尝试整包 data（Ollama 等顶层字段）
    const usage =
      extractProviderUsage(resp.data?.usage) ?? extractProviderUsage(resp.data);
    return {
      content: msg.content ?? "",
      tool_calls: rawToolCalls,
      usage,
    };
  }

  private async verifyLastOperation(): Promise<void> {
    // 取最近的 bash/write 结果
    const toolMsgs = this.messages.filter((m) => m.role === "tool");
    if (toolMsgs.length === 0) return;

    try {
      const lastResult = JSON.parse(toolMsgs[toolMsgs.length - 1].content!);
      const vr = await this.verifier.verify(
        "文件操作/Bash执行",
        "操作成功完成",
        lastResult.output
      );
      const icon = vr.verdict === "PASS" ? "✅" : vr.verdict === "FAIL" ? "❌" : "⚠️";
      console.error(icon + " 验证结果: " + vr.verdict);
      if (vr.verdict !== "PASS") {
        console.error("   详情: " + vr.details);
      }
      this.emit("verification", vr.verdict, vr.details ?? vr.verdict);
    } catch {
      // 忽略验证错误
    }
  }

  async persistVerificationCommand(): Promise<void> {
    const workspaceDir = this.getWorkspaceDir();
    const filePath = path.join(workspaceDir, ".qling-verify.json");
    try {
      if (this.verificationCommand) {
        await fs.writeFile(filePath, JSON.stringify({ verificationCommand: this.verificationCommand }, null, 2), "utf-8");
      } else {
        if (existsSync(filePath)) {
          await fs.unlink(filePath);
        }
      }
    } catch (err) {
      console.error("[AgentLoop] Failed to persist verification command: " + (err as Error).message);
    }
  }

  async loadVerificationCommand(): Promise<void> {
    const workspaceDir = this.getWorkspaceDir();
    const filePath = path.join(workspaceDir, ".qling-verify.json");
    if (existsSync(filePath)) {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const data = JSON.parse(content);
        this.verificationCommand = data.verificationCommand ?? null;
      } catch (err) {
        console.error("[AgentLoop] Failed to load verification command: " + (err as Error).message);
      }
    }
  }

  runVerificationCommand(cmd: string): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      exec(cmd, { cwd: this.getWorkspaceDir() }, (error, stdout, stderr) => {
        const code = error ? (error.code ?? 1) : 0;
        resolve({ code, stdout, stderr });
      });
    });
  }

  private async checkAutoDream(): Promise<void> {
    try {
      const transcript = this.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => m.content);

      let memories: string[];
      let changedCount = 0;

      if (this.memoryDreamLLMEnabled) {
        memories = await extractDreamMemoriesLLM(
          transcript,
          this.turnCount,
          {
            enabled: true,
            model: this.config.model,
            maxTokens: 300,
            apiKey: this.config.apiKey,
            endpoint: this.config.endpoint ?? "https://api.deepseek.com",
          }
        );

        const { consolidateMemoriesLLM } = await import("./memory/consolidation.js");
        const existing = this.memoryStore.exportPersisted();
        const ops = await consolidateMemoriesLLM(memories, existing, {
          apiKey: this.config.apiKey,
          endpoint: this.config.endpoint ?? "https://api.deepseek.com",
          model: this.config.model,
        });

        this.memoryStore.applyOperations(ops, "workspace");
        changedCount = ops.filter((op) => op.action !== "NOOP").length;
      } else {
        memories = await extractDreamMemories(
          { turnCount: this.turnCount, transcript },
          { enabled: true, turnThreshold: this.memoryDreamTurnThreshold, transcriptWindow: 4 }
        );
        const existingContents = new Set(this.memoryStore.exportPersisted().map((e) => e.content));
        const newMems = memories.filter((m) => !existingContents.has(m));
        for (const mem of newMems) {
          this.memoryStore.add(mem, "auto-dream", 0.6);
        }
        changedCount = newMems.length;
      }

      if (changedCount > 0) {
        this.memoryStore.compactPersisted(this.memoryMaxEntries);
        await this.memoryStore.saveToDisk();
        console.error("[AutoDream] " + changedCount + " 项长期记忆已整理并保存");
      }
    } catch (err) {
      // ignore
    }
  }

  private logTurnTelemetry(metrics: TurnTelemetry): void {
    this.toolCallTotal += metrics.toolCalls;
    this.toolFailureTotal += metrics.toolFailures;

    const turnFailureRate =
      metrics.toolCalls === 0 ? 0 : Math.round((metrics.toolFailures / metrics.toolCalls) * 100);
    const totalFailureRate =
      this.toolCallTotal === 0 ? 0 : Math.round((this.toolFailureTotal / this.toolCallTotal) * 100);

    const text =
      "📊 [Obs] turn=" +
      metrics.turn +
      " tools=" +
      metrics.toolCalls +
      " turnFailRate=" +
      turnFailureRate +
      "% totalFailRate=" +
      totalFailureRate +
      "% compactions=" +
      this.compactionCount +
      " retries=" +
      this.retryCountTotal;
    if (this.loggingConfig.format === "json") {
      console.error(
        JSON.stringify({
          type: "observability",
          turn: metrics.turn,
          toolCalls: metrics.toolCalls,
          turnFailureRate,
          totalFailureRate,
          compactions: this.compactionCount,
          retries: this.retryCountTotal,
        })
      );
      return;
    }
    console.error(text);
  }

  private buildRuntimeMetaSection(): string {
    const runtime = this.config.runtime;
    const workspace = runtime?.workspaceDir ?? "(disabled)";
    const cache = runtime?.fileCacheDir ?? path.join(this.runtimeRootDir, "cache");
    const state = runtime?.fileStateDir ?? this.runtimeRootDir;
    return [
      "【Runtime Meta】",
      `provider=${this.config.provider ?? "default"}`,
      `endpoint=${this.config.endpoint ?? "default"}`,
      `workspace_dir=${workspace}`,
      `file_cache_dir=${cache}`,
      `file_state_dir=${state}`,
    ].join("\n");
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

  private parseToolArguments(
    raw: string
  ): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
    const retries = Math.max(0, this.config.runtime?.parseRetries ?? 0);
    let candidate = String(raw ?? "");
    let lastError = "invalid arguments";

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          lastError = "arguments must be a JSON object";
        } else {
          return { ok: true, value: parsed as Record<string, unknown> };
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (attempt < retries) {
        candidate = this.repairToolArguments(candidate, attempt);
      }
    }

    return {
      ok: false,
      error: `failed after ${retries + 1} attempt(s): ${lastError}`,
    };
  }

  private repairToolArguments(source: string, attempt: number): string {
    let out = source.trim();
    if (attempt === 0) {
      const fenced = out.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      if (fenced) {
        out = fenced[1].trim();
      }
      return out;
    }
    if (attempt === 1) {
      return out.replace(/,\s*([}\]])/g, "$1");
    }
    if (attempt === 2) {
      return out
        .replace(/[“”]/g, "\"")
        .replace(/[‘’]/g, "'")
        .replace(/([{,]\s*)'([^']+?)'\s*:/g, '$1"$2":')
        .replace(/:\s*'([^']*?)'(\s*[,}])/g, ': "$1"$2');
    }
    return out;
  }

  private buildToolSignature(name: string, args: Record<string, unknown>): string {
    return `${name}:${this.stableStringify(args)}`;
  }

  private stableStringify(value: unknown): string {
    const normalize = (input: unknown): unknown => {
      if (Array.isArray(input)) {
        return input.map((item) => normalize(item));
      }
      if (input && typeof input === "object") {
        const entries = Object.entries(input as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b)
        );
        const obj: Record<string, unknown> = {};
        for (const [k, v] of entries) {
          obj[k] = normalize(v);
        }
        return obj;
      }
      return input;
    };

    try {
      return JSON.stringify(normalize(value));
    } catch {
      return "[unstringifiable]";
    }
  }
}
