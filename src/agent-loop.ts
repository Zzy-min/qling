// ============================================================
// 轻灵 - Agent Loop v2（整合 Pipeline Hook + Section Prompt + Token Budget）
// ============================================================

import axios from "axios";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { dispatch, ALL_TOOLS } from "./tools/index.js";
import { HookManager, ToolPipeline } from "./pipeline/hooks.js";
import { buildDefaultRegistry, buildSystemPrompt, SECTION_IDS } from "./pipeline/sections.js";
import { MemoryStore, TokenBudgetManager, extractDreamMemories } from "./memory.js";
import { VerificationAgent } from "./pipeline/verification.js";
import { ContextCompactor } from "./context-compactor.js";
import { KnowledgeAgentAdapter } from "./knowledge-agent.js";
import type { AgentConfig, Message, RawToolCall, ToolCall, ToolResult } from "./types.js";

const HOME_DIR = os.homedir();
const QINGLING_DIR = path.join(HOME_DIR, ".qingling");
const MEMORY_DIR = path.join(QINGLING_DIR, "memory");
const MEMORY_FILE = path.join(MEMORY_DIR, "memory.json");

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

  // v2 新组件
  private hookManager: HookManager;
  private pipeline: ToolPipeline;
  private sectionRegistry = buildDefaultRegistry(ALL_TOOLS);
  private memoryStore: MemoryStore;
  private tokenBudget: TokenBudgetManager;
  private verifier: VerificationAgent;
  private compactor: ContextCompactor;
  private knowledgeAdapter: KnowledgeAgentAdapter;

  // Token 追踪（仅计增量，避免每轮重复计算整个上下文）
  private sessionTokens = 0;

  constructor(config: Partial<AgentConfig> = {}) {
    super();
    const apiKey = config.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "";
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required");

    this.config = {
      apiKey,
      model: config.model ?? "deepseek-chat",
      systemPrompt: config.systemPrompt ?? "",
      maxIterations: config.maxIterations ?? 50,
      tools: config.tools ?? ALL_TOOLS,
      tokenBudget: config.tokenBudget ?? {
        maxTokens: 120_000,
        nudgeThreshold: 0.2,
        totalBudget: 120_000,
      },
    };

    // 初始化 v2 组件
    this.hookManager = new HookManager(this.config.tools);
    this.pipeline = new ToolPipeline(this.config.tools, this.hookManager);
    this.memoryStore = new MemoryStore(MEMORY_DIR);
    this.tokenBudget = new TokenBudgetManager(
      this.config.tokenBudget?.totalBudget ?? 120_000,
      this.config.tokenBudget?.nudgeThreshold ?? 0.2
    );
    this.verifier = new VerificationAgent(apiKey, this.config.model);
    this.compactor = new ContextCompactor(6000, this.config.model);
    this.knowledgeAdapter = new KnowledgeAgentAdapter(this.memoryStore);

    // HTTP client + retry interceptor
    this.client = axios.create({
      baseURL: "https://api.deepseek.com",
      headers: {
        Authorization: "Bearer " + this.config.apiKey,
        "Content-Type": "application/json",
      },
      timeout: 120_000,
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (err) => {
        const cfg = err.config;
        const maxRetries = 3;
        cfg.__retryCount = cfg.__retryCount ?? 0;
        // 只在 429 / 500-503 / ECONNRESET / ETIMEDOUT 时重试
        const shouldRetry =
          (!err.response ||
            err.response?.status === 429 ||
            err.response?.status >= 500) &&
          cfg.__retryCount < maxRetries &&
          !err.config?.params?.includes("already_retried");
        if (shouldRetry) {
          cfg.__retryCount++;
          const delay = Math.min(1000 * Math.pow(2, cfg.__retryCount - 1), 10_000);
          await new Promise((r) => setTimeout(r, delay));
          return this.client(cfg);
        }
        return Promise.reject(err);
      }
    );

    // 初始化系统
    this.init();
  }

  private async init(): Promise<void> {
    await fs.mkdir(QINGLING_DIR, { recursive: true });
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    try {
      await this.memoryStore.init();
    } catch {
      // ignore
    }
  }

  // --- Public API ---

  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
    this.knowledgeAdapter.onUserMessage(content);
  }

  async run(): Promise<string> {
    for (let i = 0; i < this.config.maxIterations; i++) {
      this.turnCount++;

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
      const roundTokens = (lastMsg?.content?.length ?? 0) * 4 + 500;
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
        return content;
      }

      // 5. Pipeline 执行（Hook → 工具）
      console.error("\n🔧 执行 " + tool_calls.length + " 个工具...\n");
      const parsed: ToolCall[] = tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      }));

      for (let j = 0; j < parsed.length; j++) {
        const tc = parsed[j];
        // 知识观察：工具调用前
        this.knowledgeAdapter.onToolCall(tc);
        this.emit("tool_start", tc.name, tc.arguments);
        const result = await this.pipeline.execute(tc, (t) => dispatch(t));
        // 知识观察：工具结果后
        this.knowledgeAdapter.onToolResult(result, tc.name);
        this.emit("tool_result", tc.name, result.output, result.is_error ?? false);
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
      this.memoryStore.addConversationTurn(
        "user",
        this.messages[this.messages.length - 2]?.content ?? ""
      );
      this.memoryStore.addConversationTurn("assistant", content);

      // 7c. 知识观察：助手消息 + 回合结束
      this.knowledgeAdapter.onAssistantMessage(content);
      await this.knowledgeAdapter.onTurnEnd(this.turnCount);
    }

    return "⚠️ 达到最大迭代次数，任务未完成。";
  }

  reset(): void {
    this.messages = [];
    this.turnCount = 0;
    this.sectionRegistry.clearCache();
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
    return buildSystemPrompt(this.sectionRegistry, {
      memory: memory || undefined,
    });
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

      const memories = await extractDreamMemories(
        { turnCount: this.turnCount, transcript },
        { enabled: true, turnThreshold: 24, transcriptWindow: 4 }
      );

      for (const mem of memories) {
        this.memoryStore.add(mem, "auto-dream", 0.6);
      }

      if (memories.length > 0) {
        await this.memoryStore.saveToDisk();
        console.error("💭 [AutoDream] 从 " + memories.length + " 条新记忆已保存");
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
}
