// ============================================================
// 轻灵 - Pipeline Hook 系统（参考 Claude Code 5.x Hook 架构）
// ============================================================

import {
  ToolCall,
  ToolResult,
  ToolHookContext,
  HookResult,
  PreToolUseHandler,
  PostToolUseHandler,
  FailureHandler,
  PermissionDecision,
  ClassifierResult,
  ToolDefinition,
} from "../types.js";
import { PermissionMatrix, type PermissionResult } from "../guard/permissions.js";
import { RateLimiter, type RateLimitResult } from "../guard/rate-limit.js";
import { appendGuardAudit } from "../guard.js";
import type { GuardConfig } from "../config.js";

// --- 0. 动态工具选择器（<30 工具限制 + 场景路由）---

const MAX_TOOLS_DEFAULT = 30;

export class DynamicToolSelector {
  constructor(
    private allTools: ToolDefinition[],
    private maxTools: number = MAX_TOOLS_DEFAULT
  ) {}

  /**
   * 根据场景选择工具子集。
   * 策略：
   * 1. activeScene 中声明的工具优先
   * 2. 未声明场景的工具（通用工具如 read/write）始终保留
   * 3. 按 priority 排序后截断到 maxTools
   */
  selectForScene(activeScene: string): ToolDefinition[] {
    if (this.allTools.length <= this.maxTools) {
      return this.allTools;
    }

    const scored = this.allTools.map((tool) => {
      let score = tool.priority ?? 5;

      // 场景匹配加 20 分
      if (tool.scenes?.includes(activeScene)) {
        score += 20;
      }

      // 核心工具（read/write/bash）不受场景限制
      const coreTools = ["read", "write", "bash"];
      if (coreTools.includes(tool.name)) {
        score += 50;
      }

      return { tool, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, this.maxTools).map((s) => s.tool);
  }

  /**
   * 根据任务类型关键词选择工具。
   * 关键词匹配 scenes 或 name。
   */
  selectByKeywords(keywords: string[]): ToolDefinition[] {
    if (this.allTools.length <= this.maxTools) {
      return this.allTools;
    }

    const scored = this.allTools.map((tool) => {
      let score = tool.priority ?? 5;
      for (const kw of keywords) {
        if (tool.name.includes(kw)) score += 10;
        if (tool.scenes?.some((s) => s.includes(kw))) score += 5;
        if (tool.description.toLowerCase().includes(kw.toLowerCase())) score += 2;
      }
      return { tool, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, this.maxTools).map((s) => s.tool);
  }

  getAll(): ToolDefinition[] {
    return this.allTools;
  }

  getCount(): number {
    return this.allTools.length;
  }
}

// --- 1. Dangerous Pattern Registry ---

const BUILT_IN_DANGEROUS_PATTERNS = [
  // 文件删除
  /\brm\s+-rf\s+\//,
  /\bdel\s+\/[sfq]\b/i,
  /rmdir\s+\/[efqs]/i,
  // 格式化
  /\bformat\b.*\b[a-z]:/i,
  /\bnewfs\b/,
  // 权限修改
  /\bchmod\s+777\b/,
  /\bchmod\s+-R\s+777\b/,
  // 网络相关
  /\bwget\b.*\s--no-check-certificate/,
  /\bcurl\b.*\s-k\b/,
  // 提权
  /\bsudo\s+su\b/,
  /\bsu\s+-\b/,
  // 危险管道
  /\|.*\s*sh\b/,
  /\|.*\s*bash\b/,
  // 进程终止
  /\bkill\s+-9\b/,
  /\bpkill\s+-9\b/,
  // 敏感文件
  /\/etc\/passwd/,
  /\/etc\/shadow/,
  /\.ssh\/authorized_keys/,
  // 内存修改
  /\bdd\b.*\sif=.*\bof=\/dev/,
];

function matchDangerousPatterns(
  cmd: string,
  patterns: (string | RegExp)[]
): string[] {
  const allPatterns: (string | RegExp)[] = [
    ...BUILT_IN_DANGEROUS_PATTERNS,
    ...patterns,
  ];
  const matched: string[] = [];
  for (const p of allPatterns) {
    const re = typeof p === "string" ? new RegExp(p) : p;
    if (re.test(cmd)) {
      matched.push(typeof p === "string" ? p : String(p));
    }
  }
  return matched;
}

// --- 2. Speculative Classifier（3.2 节）---

export class SpeculativeClassifier {
  constructor(private toolDefs: ToolDefinition[]) {}

  classify(toolCall: ToolCall): ClassifierResult {
    const def = this.toolDefs.find((t) => t.name === toolCall.name);

    // bash 类工具才需要分类
    if (toolCall.name !== "bash") {
      return { label: "safe" };
    }

    const cmd = String(toolCall.arguments.command ?? "");
    if (!cmd) return { label: "safe" };

    const matched = matchDangerousPatterns(
      cmd,
      def?.dangerousPatterns ?? []
    );

    if (matched.length > 0) {
      return {
        label: "dangerous",
        reason: `匹配危险模式: ${matched.join(", ")}`,
        patterns: matched,
      };
    }

    // 读操作风险低
    if (
      def?.readOnly ||
      /^\s*(ls|git\s+(status|log|diff)|cat|head|tail|grep|find|wc|echo|pwd)\s/.test(
        cmd
      )
    ) {
      return { label: "safe" };
    }

    // 写/删除操作需要询问（仅明确危险的操作才拦截）
    // curl/wget GET 请求是只读的，不拦截
    // tee / 追加写入属于中等风险，放宽判断
    if (
      def?.destructive ||
      /\b(del|rmdir|rm\s+-rf|mkfs|truncate\s+-s\s+0)\b/.test(cmd)
    ) {
      return { label: "ask" };
    }

    return { label: "safe" };
  }
}

// --- 3. Hook Manager ---

/** Plan 模式下禁止的写/执行类工具（OpenCode plan agent 语义） */
export const PLAN_MODE_DENY_TOOLS = [
  "write",
  "patch",
  "bash",
  "subtask",
  "browser_fetch",
] as const;

export class HookManager {
  private preHooks: PreToolUseHandler[] = [];
  private postHooks: PostToolUseHandler[] = [];
  private failureHooks: FailureHandler[] = [];
  private classifier: SpeculativeClassifier;
  private permissionMatrix: PermissionMatrix | null = null;
  private rateLimiter: RateLimiter | null = null;
  private guardConfig: GuardConfig | null = null;
  private planMode = false;

  constructor(toolDefs: ToolDefinition[], guardConfig?: GuardConfig) {
    this.classifier = new SpeculativeClassifier(toolDefs);
    if (guardConfig) {
      this.guardConfig = guardConfig;
      if (guardConfig.permissions) {
        this.permissionMatrix = new PermissionMatrix(
          guardConfig.permissions.default,
          this.mergePermissionRules(guardConfig.permissions.rules)
        );
      }
      if (guardConfig.rate_limit?.enabled) {
        this.rateLimiter = new RateLimiter(guardConfig.rate_limit.max_per_minute);
      }
    }
  }

  private planModeRules(): Array<{ tool_pattern: string; decision: "deny"; reason: string }> {
    return PLAN_MODE_DENY_TOOLS.map((tool) => ({
      tool_pattern: tool,
      decision: "deny" as const,
      reason: `Plan Mode: 工具 ${tool} 已禁用（只读规划）。使用 /plan off 退出。`,
    }));
  }

  private mergePermissionRules(
    baseRules: Array<{ tool_pattern: string; decision: "allow" | "deny" | "ask"; reason?: string }> = []
  ) {
    // plan 规则优先（放前面）
    return this.planMode ? [...this.planModeRules(), ...baseRules] : baseRules;
  }

  private rebuildPermissionMatrix(): void {
    const defaultDecision = this.guardConfig?.permissions?.default ?? "allow";
    const rules = this.mergePermissionRules(this.guardConfig?.permissions?.rules ?? []);
    this.permissionMatrix = new PermissionMatrix(defaultDecision, rules);
  }

  isPlanMode(): boolean {
    return this.planMode;
  }

  setPlanMode(enabled: boolean): void {
    this.planMode = Boolean(enabled);
    this.rebuildPermissionMatrix();
  }

  getPermissionDefaultDecision(): "allow" | "deny" | "ask" {
    return this.guardConfig?.permissions?.default ?? "allow";
  }

  setPermissionDefaultDecision(decision: "allow" | "deny" | "ask"): void {
    const currentRules = this.guardConfig?.permissions?.rules ?? [];
    if (this.guardConfig) {
      this.guardConfig.permissions = {
        ...(this.guardConfig.permissions ?? { rules: [] }),
        default: decision,
        rules: currentRules,
      };
    }
    this.rebuildPermissionMatrix();
  }

  register(name: "PreToolUse", handler: PreToolUseHandler): void;
  register(name: "PostToolUse", handler: PostToolUseHandler): void;
  register(name: "PostToolUseFailure", handler: FailureHandler): void;
  register(name: string, handler: PreToolUseHandler | PostToolUseHandler | FailureHandler): void {
    if (name === "PreToolUse") this.preHooks.push(handler as PreToolUseHandler);
    else if (name === "PostToolUse") this.postHooks.push(handler as PostToolUseHandler);
    else if (name === "PostToolUseFailure") this.failureHooks.push(handler as FailureHandler);
  }

  async runPreHook(ctx: ToolHookContext, sessionId?: string): Promise<HookResult> {
    // 1. Permission matrix check (highest priority)
    if (this.permissionMatrix && this.guardConfig) {
      const permResult = this.permissionMatrix.evaluate(ctx.toolName);
      if (permResult.decision === "deny") {
        await appendGuardAudit(this.guardConfig, {
          tool: ctx.toolName,
          action: "deny",
          category: "permission",
          reason: permResult.reason ?? "denied by permission rule: " + (permResult.matched_rule ?? "default"),
        });
        return {
          decision: "deny",
          blockingError: permResult.reason ?? "工具权限拒绝: " + ctx.toolName,
          preventContinuation: true,
        };
      }
      if (permResult.decision === "ask") {
        await appendGuardAudit(this.guardConfig, {
          tool: ctx.toolName,
          action: "allow",
          category: "permission",
          reason: "ask triggered by rule: " + (permResult.matched_rule ?? "default"),
        });
        return {
          decision: "ask",
          additionalContexts: [permResult.reason ?? "工具需要确认: " + ctx.toolName],
        };
      }
    }

    // 2. Rate limit check
    if (this.rateLimiter && sessionId) {
      const rlResult = this.rateLimiter.check(ctx.toolName, sessionId);
      if (!rlResult.allowed) {
        if (this.guardConfig) {
          await appendGuardAudit(this.guardConfig, {
            tool: ctx.toolName,
            action: "deny",
            category: "rate_limit",
            reason: `rate limit exceeded, retry after ${rlResult.retryAfterMs}ms`,
          });
        }
        return {
          decision: "deny",
          blockingError: `速率限制: 工具 ${ctx.toolName} 调用过于频繁，请 ${Math.ceil((rlResult.retryAfterMs ?? 0) / 1000)}s 后重试`,
          preventContinuation: false,
        };
      }
    }

    // 3. Speculative classifier
    const fakeCall: ToolCall = {
      id: "speculative",
      name: ctx.toolName,
      arguments: ctx.arguments as Record<string, unknown>,
    };
    const classification = this.classifier.classify(fakeCall);

    if (classification.label === "dangerous") {
      return {
        decision: "deny",
        blockingError: classification.reason ?? "危险命令",
        preventContinuation: true,
      };
    }

    if (classification.label === "ask") {
      return {
        decision: "ask",
        additionalContexts: classification.patterns
          ? [`⚠️ 匹配危险模式: ${classification.patterns.join(", ")}`]
          : ["⚠️ 这个操作可能具有破坏性"],
      };
    }

    // 4. Custom pre-hooks
    for (const handler of this.preHooks) {
      const result = await handler(ctx);
      if (result.decision === "deny") return result;
      if (result.decision === "ask") return result;
    }

    return { decision: "allow" };
  }

  async runPostHook(ctx: ToolHookContext, result: ToolResult): Promise<void> {
    for (const handler of this.postHooks) {
      await handler(ctx, result);
    }
  }

  async runFailureHook(ctx: ToolHookContext, error: Error): Promise<void> {
    for (const handler of this.failureHooks) {
      await handler(ctx, error);
    }
  }
}

// --- 4. Tool Pipeline Orchestrator（3.3 节）---

export interface PipelineContext {
  toolCall: ToolCall;
  toolDef: ToolDefinition | undefined;
  hookCtx: ToolHookContext;
}

export class ToolPipeline {
  private sessionId: string | null = null;

  constructor(
    private toolDefs: ToolDefinition[],
    private hookManager: HookManager
  ) {}

  setSessionId(id: string): void {
    this.sessionId = id;
  }

  async execute(toolCall: ToolCall, runner: (tc: ToolCall) => Promise<ToolResult>): Promise<ToolResult> {
    const def = this.toolDefs.find((t) => t.name === toolCall.name);
    const hookCtx = this.buildHookContext(toolCall, def);

    // 1. PreHook（含 Permission Matrix + Rate Limiter + Speculative Classifier）
    const preResult = await this.hookManager.runPreHook(hookCtx, this.sessionId ?? undefined);

    if (preResult.decision === "deny") {
      console.error(`🚫 [Pipeline] 工具 ${toolCall.name} 被 Hook 拦截: ${preResult.blockingError}`);
      return {
        tool_call_id: toolCall.id,
        output: `【权限拒绝】${preResult.blockingError ?? "Hook denied"}`,
        is_error: true,
      };
    }

    if (preResult.decision === "ask") {
      const { ApprovalRequiredError } = await import("../guard/approval.js");
      throw new ApprovalRequiredError(
        toolCall.id,
        toolCall.name,
        preResult.additionalContexts ?? ["需要确认"]
      );
    }

    // 2. 执行工具
    try {
      const result = await runner(toolCall);

      // 3. PostHook
      await this.hookManager.runPostHook(hookCtx, result);

      return result;
    } catch (err) {
      // 4. Failure Hook
      await this.hookManager.runFailureHook(hookCtx, err as Error);
      throw err;
    }
  }

  private buildHookContext(
    toolCall: ToolCall,
    def: ToolDefinition | undefined
  ): ToolHookContext {
    const cmd = String(toolCall.arguments.command ?? "");
    const matched = matchDangerousPatterns(cmd, def?.dangerousPatterns ?? []);

    return {
      toolName: toolCall.name,
      arguments: toolCall.arguments,
      inputSchema: def?.parameters ?? {},
      isReadOnly: def?.readOnly ?? toolCall.name !== "bash",
      isDestructive: def?.destructive ?? /\b(rm|del|rmdir)\b/.test(cmd),
      isConcurrencySafe: def?.concurrencySafe ?? false,
      dangerousPatterns: matched,
    };
  }
}
