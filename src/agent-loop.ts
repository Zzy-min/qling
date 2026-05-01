// ============================================================
// 轻灵 - Agent Loop v2（整合 Pipeline Hook + Section Prompt + Token Budget）
// ============================================================

import axios from "axios";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { dispatch, ALL_TOOLS, setMCPRegistry } from "./tools/index.js";
import { HookManager, ToolPipeline } from "./pipeline/hooks.js";
import { buildDefaultRegistry, buildSystemPrompt, SECTION_IDS } from "./pipeline/sections.js";
import { MemoryStore, TokenBudgetManager, extractDreamMemories } from "./memory.js";
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
import { getSkillDirs } from "./tools/skill.js";
import { listSkills } from "./skills/registry.js";
import { buildSkillsSection } from "./pipeline/sections.js";
import { applyContentFilter, setCustomPatterns } from "./guard/content-filter.js";
import { appendGuardAudit } from "./guard.js";
import { guardConfigFromEnv, type GuardConfig } from "./config.js";

const HOME_DIR = os.homedir();
const DEFAULT_QINGLING_DIR = path.join(HOME_DIR, ".qingling");

interface TurnTelemetry {
  turn: number;
  toolCalls: number;
  toolFailures: number;
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
  private tokenBudget: TokenBudgetManager;
  private verifier: VerificationAgent;
  private compactor: ContextCompactor;
  private knowledgeAdapter: KnowledgeAgentAdapter;
  private wal: WriteAheadLog | null = null;
  private memoryWalEnabled = false;
  private memoryDreamLLMEnabled = false;
  private memoryDreamTurnThreshold = 24;
  private memoryMaxEntries = 1000;
  private mcpRegistry: MCPRegistry | null = null;
  private approvalGate: ApprovalGate;
  private metricsCollector: MetricsCollector | null = null;
  private metricsFlushTimer: ReturnType<typeof setInterval> | null = null;
  private telemetry: AgentTelemetry | null = null;
  private channel: Channel | null = null;
  private sessionId: string;
  private guardConfig: GuardConfig;

  // Token 追踪（仅计增量，避免每轮重复计算整个上下文）
  private sessionTokens = 0;
  private initPromise: Promise<void>;

  // 轻量观测指标
  private compactionCount = 0;
  private retryCountTotal = 0;
  private toolCallTotal = 0;
  private toolFailureTotal = 0;

  constructor(config: Partial<AgentConfig> = {}) {
    super();
    const apiKey =
      config.apiKey ?? process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
    if (!apiKey) {
      throw new Error("Missing API key (expected config.apiKey / DEEPSEEK_API_KEY / OPENAI_API_KEY)");
    }

    const provider = config.provider ?? process.env.QINGLING_LLM_PROVIDER ?? "deepseek";
    const endpoint =
      config.endpoint ??
      process.env.QINGLING_LLM_ENDPOINT ??
      process.env.OPENAI_BASE_URL ??
      process.env.DEEPSEEK_BASE_URL ??
      (provider === "openai" ? "https://api.openai.com/v1" : "https://api.deepseek.com");
    this.runtimeRootDir = path.resolve(
      config.runtime?.fileStateDir ??
        process.env.QINGLING_FILE_STATE_DIR ??
        DEFAULT_QINGLING_DIR
    );
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
      tokenBudget: config.tokenBudget ?? {
        maxTokens: 120_000,
        nudgeThreshold: 0.2,
        totalBudget: 120_000,
      },
      runtime: {
        workspaceDir: config.runtime?.workspaceDir ?? process.env.QINGLING_WORKSPACE_DIR ?? process.cwd(),
        fileCacheDir:
          config.runtime?.fileCacheDir ??
          process.env.QINGLING_FILE_CACHE_DIR ??
          path.join(this.runtimeRootDir, "cache"),
        fileStateDir: this.runtimeRootDir,
        maxSteps: config.runtime?.maxSteps ?? 50,
        parseRetries: config.runtime?.parseRetries ?? 2,
        maxTokenBudget: config.runtime?.maxTokenBudget ?? 120_000,
        toolRepeatLimit: config.runtime?.toolRepeatLimit ?? 6,
        timeoutMs: config.runtime?.timeoutMs ?? 300_000,
      },
      logging: this.loggingConfig,
    };
    this.sectionRegistry = buildDefaultRegistry(this.config.tools);
    this.sessionId = "session-" + Date.now();
    this.approvalGate = new ApprovalGate();
    this.guardConfig = guardConfigFromEnv();

    // 初始化 v2 组件
    this.hookManager = new HookManager(this.config.tools, this.guardConfig);
    this.pipeline = new ToolPipeline(this.config.tools, this.hookManager);
    this.pipeline.setSessionId(this.sessionId);
    this.memoryStore = new MemoryStore(this.memoryDir);
    this.tokenBudget = new TokenBudgetManager(
      this.config.tokenBudget?.totalBudget ?? 120_000,
      this.config.tokenBudget?.nudgeThreshold ?? 0.2
    );
    this.verifier = new VerificationAgent(apiKey, this.config.model);
    this.compactor = new ContextCompactor(6000, this.config.model);
    this.knowledgeAdapter = new KnowledgeAgentAdapter(this.memoryStore);

    // HTTP client + retry interceptor
    this.client = axios.create({
      baseURL: endpoint,
      headers: {
        Authorization: "Bearer " + this.config.apiKey,
        "Content-Type": "application/json",
      },
      timeout: this.config.runtime?.timeoutMs ?? 120_000,
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
    if (this.loggingConfig.inspectPrompt || this.loggingConfig.inspectRequest) {
      await fs.mkdir(this.loggingConfig.inspectDumpDir, { recursive: true });
    }

    // WAL initialization
    const walEnabled = process.env.QINGLING_MEMORY_WAL_ENABLED !== "false";
    const projectionIntervalRaw = Number(process.env.QINGLING_MEMORY_PROJECTION_INTERVAL_MS ?? "5000");
    const projectionInterval =
      Number.isFinite(projectionIntervalRaw) && projectionIntervalRaw > 0
        ? projectionIntervalRaw
        : 5000;
    const dreamLLM = process.env.QINGLING_MEMORY_DREAM_LLM_ENABLED !== "false";
    const dreamThresholdRaw = Number(process.env.QINGLING_MEMORY_DREAM_TURN_THRESHOLD ?? "24");
    const dreamThreshold =
      Number.isFinite(dreamThresholdRaw) && dreamThresholdRaw > 0
        ? dreamThresholdRaw
        : 24;
    const memoryMaxEntriesRaw = Number(process.env.QINGLING_MEMORY_MAX_MEMORIES ?? "1000");
    this.memoryMaxEntries =
      Number.isFinite(memoryMaxEntriesRaw) && memoryMaxEntriesRaw > 0
        ? Math.floor(memoryMaxEntriesRaw)
        : 1000;
    this.memoryWalEnabled = walEnabled;
    this.memoryDreamLLMEnabled = dreamLLM;
    this.memoryDreamTurnThreshold = dreamThreshold;

    if (walEnabled) {
      try {
        const walDir = path.join(this.memoryDir, "wal");
        this.wal = new WriteAheadLog(walDir);
        await this.wal.init();
        this.memoryStore.setWAL(this.wal, { intervalMs: projectionInterval });
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

    // Metrics initialization
    const metricsEnabled = process.env.QINGLING_METRICS_ENABLED === "true";
    if (metricsEnabled) {
      try {
        const metricsDir = path.resolve(
          process.env.QINGLING_METRICS_DIR ?? path.join(this.runtimeRootDir, "metrics")
        );
        const flushIntervalRaw = Number(process.env.QINGLING_METRICS_FLUSH_INTERVAL_MS ?? "10000");
        const flushIntervalMs =
          Number.isFinite(flushIntervalRaw) && flushIntervalRaw > 0
            ? flushIntervalRaw
            : 10000;
        this.metricsCollector = new MetricsCollector(metricsDir, this.sessionId, flushIntervalMs);
        await this.metricsCollector.init();
        this.metricsFlushTimer = this.metricsCollector.startAutoFlush();
        this.telemetry = new AgentTelemetry(this.metricsCollector, this.sessionId);
        console.error("[Metrics] enabled, dir=" + metricsDir);
      } catch (err) {
        console.error("[Metrics] init failed: " + (err as Error).message);
      }
    }

    // MCP initialization
    const mcpServersRaw = process.env.QINGLING_MCP_SERVERS;
    if (mcpServersRaw) {
      try {
        const mcpConnTimeoutRaw = Number(process.env.QINGLING_MCP_CONNECTION_TIMEOUT_MS ?? "10000");
        const mcpCallTimeoutRaw = Number(process.env.QINGLING_MCP_CALL_TIMEOUT_MS ?? "30000");
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

    for (let i = 0; i < this.config.maxIterations; i++) {
      this.turnCount++;

      // 保存本轮用户消息（在 assistant/tool 消息 push 之前）
      let lastUserMsg = "";
      for (let k = this.messages.length - 1; k >= 0; k--) {
        if (this.messages[k].role === "user") {
          lastUserMsg = this.messages[k].content;
          break;
        }
      }

      // 0. Token Budget Nudge
      if (this.tokenBudget.shouldNudge()) {
        const nudge = this.tokenBudget.buildNudgeMessage();
        this.messages.push({ role: "user", content: nudge });
        console.error("\n" + nudge + "\n");
      }

      // 0b. 上下文压缩（超过阈值时触发）
      if (this.compactor.needsCompaction(this.messages)) {
        console.error("\n📦 上下文压缩中...（" + this.messages.length + " 条消息）");
        const compacted = await this.compactor.compact(this.messages);
        this.messages = compacted;
        this.compactionCount++;
        console.error("📦 压缩完成 → " + this.messages.length + " 条消息\n");
      }

      // 0c. 冲突/注入扫描（Lesson 12: Context Validation）
      const conflicts = this.compactor.scanConflicts(this.messages);
      if (conflicts.length > 0) {
        console.error("⚠️ 检测到 " + conflicts.length + " 处指令冲突");
      }
      const poison = this.compactor.scanPoison(this.messages);
      if (poison.length > 0) {
        console.error("🚨 检测到 " + poison.length + " 处可能的提示注入");
      }

      // 1. 构建 system prompt（动态sections）
      const systemPrompt = this.buildSystemPrompt();

      // 2. 检查上下文大小（仅计增量，不重复累加整个上下文）
      const lastMsg = this.messages[this.messages.length - 1];
      const roundTokens = (lastMsg?.content?.length ?? 0) * 4 + (systemPrompt.length * 0.5);
      this.sessionTokens += roundTokens;
      this.tokenBudget.addUsage(roundTokens);

      // 3. API 调用
      const { content, tool_calls } = await this.chat(systemPrompt);
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
        return content;
      }

      // 5. Pipeline 执行（Hook → 工具）
      console.error("\n🔧 执行 " + tool_calls.length + " 个工具...\n");
      const parsed: ToolCall[] = tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      }));
      let turnToolCalls = 0;
      let turnToolFailures = 0;

      for (let j = 0; j < parsed.length; j++) {
        const tc = parsed[j];
        turnToolCalls++;
        // 知识观察：工具调用前
        this.knowledgeAdapter.onToolCall(tc);
        this.emit("tool_start", tc.name, tc.arguments);
        let result: ToolResult;
        try {
          result = await this.pipeline.execute(tc, (t) => dispatch(t));
        } catch (err) {
          if (err instanceof ApprovalRequiredError && this.channel) {
            // Approval flow
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
        // 知识观察：工具结果后
        this.knowledgeAdapter.onToolResult(result, tc.name);
        this.emit("tool_result", tc.name, result.output, result.is_error ?? false);

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
        this.messages.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: tc.id,
        });
      }

      // 6. 验证阶段（针对写操作）
      const hasWrites = parsed.some((t) => t.name === "write" || t.name === "bash");
      if (hasWrites) {
        await this.verifyLastOperation();
      }

      // 7. Auto-dream 检查
      await this.checkAutoDream();

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
    }

    return "⚠️ 达到最大迭代次数，任务未完成。";
  }

  getModel(): string {
    return this.config.model;
  }

  getToolCount(): number {
    return this.config.tools.length;
  }

  reset(): void {
    this.messages = [];
    this.turnCount = 0;
    this.sectionRegistry.clearCache();
  }

  setChannel(channel: Channel): void {
    this.channel = channel;
  }

  getSessionId(): string {
    return this.sessionId;
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
      const retentionDays = Number(process.env.QINGLING_METRICS_RETENTION_DAYS ?? "30");
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
    this.memoryStore.stopProjection();
    await this.memoryStore.forceCheckpoint();
    if (this.wal) {
      await this.wal.close();
    }
  }

  // --- Session Persistence ---

  async saveSession(name?: string): Promise<string> {
    const sessionName = name ?? "session-" + new Date().toISOString().replace(/[:.]/g, "-");
    const sessionDir = path.join(this.runtimeRootDir, "sessions");
    await fs.mkdir(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, sessionName + ".json");
    const data = {
      messages: this.messages,
      turnCount: this.turnCount,
      sessionTokens: this.sessionTokens,
      savedAt: new Date().toISOString(),
    };
    await fs.writeFile(sessionFile, JSON.stringify(data, null, 2), "utf-8");
    return sessionFile;
  }

  async loadSession(name: string): Promise<boolean> {
    const sessionFile = path.join(
      this.runtimeRootDir,
      "sessions",
      name.endsWith(".json") ? name : name + ".json"
    );
    try {
      const data = await fs.readFile(sessionFile, "utf-8");
      const parsed = JSON.parse(data);
      this.messages = parsed.messages ?? [];
      this.turnCount = parsed.turnCount ?? 0;
      this.sessionTokens = parsed.sessionTokens ?? 0;
      this.sectionRegistry.clearCache();
      return true;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<string[]> {
    const sessionDir = path.join(this.runtimeRootDir, "sessions");
    try {
      await fs.mkdir(sessionDir, { recursive: true });
      const files = await fs.readdir(sessionDir);
      return files.filter((f) => f.endsWith(".json")).sort().reverse();
    } catch {
      return [];
    }
  }


  // --- Private Methods ---

  private buildSystemPrompt(): string {
    // 更新 token budget section
    const budgetSec = this.sectionRegistry.get(SECTION_IDS.TOKEN_BUDGET);
    if (budgetSec) {
      const used = this.sessionTokens;
      const max = this.tokenBudget.maxTokens;
      this.sectionRegistry.register({
        ...budgetSec,
        content:
          "【Token 预算】\n已使用: ~" +
          used.toLocaleString() +
          " tokens\n剩余: ~" +
          (max - used).toLocaleString() +
          " tokens (" +
          Math.round(((max - used) / max) * 100) +
          "%)\n当剩余低于 20% 时，主动精简回复，减少工具调用频率。",
        dynamic: true,
      });
    }

    // 加载记忆
    const memory = this.memoryStore.formatPromptForContext(10);
    const sectionPrompt = buildSystemPrompt(this.sectionRegistry, {
      memory: memory || undefined,
    });
    const parts = [
      this.config.systemPrompt.trim(),
      this.buildRuntimeMetaSection(),
      sectionPrompt,
    ].filter((p) => p && p.trim().length > 0);
    return parts.join("\n\n");
  }

  private async chat(systemPrompt: string): Promise<{
    content: string;
    tool_calls?: RawToolCall[];
  }> {
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
      throw new Error("DeepSeek API error: " + detail);
    }

    const choice = resp.data.choices?.[0];
    if (!choice) throw new Error("DeepSeek API error: " + JSON.stringify(resp.data));

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

    return { content: msg.content ?? "", tool_calls: rawToolCalls };
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

  private async checkAutoDream(): Promise<void> {
    try {
      const transcript = this.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => m.content);

      let memories: string[];

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
      } else {
        memories = await extractDreamMemories(
          { turnCount: this.turnCount, transcript },
          { enabled: true, turnThreshold: this.memoryDreamTurnThreshold, transcriptWindow: 4 }
        );
      }

      for (const mem of memories) {
        this.memoryStore.add(mem, "auto-dream", 0.6);
      }

      if (memories.length > 0) {
        this.memoryStore.compactPersisted(this.memoryMaxEntries);
        await this.memoryStore.saveToDisk();
        console.error("[AutoDream] " + memories.length + " 条新记忆已保存");
      }
    } catch {
      // ignore
    }
  }

  private estimateTokens(): number {
    // 粗略估算：总字符数 × 4
    const totalChars = this.messages.reduce((sum, m) => sum + m.content.length, 0);
    return totalChars * 4;
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
}
