// ============================================================
// 轻灵 - 类型定义 v2（参考 Claude Code Agent Deep Dive v2.1）
// ============================================================

// --- Tool Call（OpenAI 格式）---

export interface RawToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id: string;
  output: string;
  is_error?: boolean;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: RawToolCall[];
  tool_call_id?: string;
}

// --- Agent Config ---

export interface AgentConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxIterations: number;
  tools: ToolDefinition[];
  // v2 新增
  tokenBudget?: TokenBudgetConfig;
  sections?: PromptSectionRegistry;
}

export interface ToolParam {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  pattern?: string;         // 正则约束（string 类型）
  minLength?: number;       // string 最小长度
  maxLength?: number;       // string 最大长度
  minimum?: number;         // number 最小值
  maximum?: number;         // number 最大值
  items?: ToolParam;        // array 元素类型
  properties?: Record<string, ToolParam>; // object 属性
}

export interface ToolDefinition {
  name: string;
  description: string;
  longDescription?: string; // 详细说明（使用场景、示例、注意事项）
  parameters: Record<string, unknown>;
  // v2 新增：详细参数 schema（Pydantic-like）
  paramSchema?: Record<string, ToolParam>;
  // v2 新增：工具元数据
  readOnly?: boolean;
  destructive?: boolean;
  concurrencySafe?: boolean;
  dangerousPatterns?: string[];
  effortHint?: "minimal" | "low" | "medium" | "high";
  examples?: string[];      // 使用示例
  seeAlso?: string[];       // 相关工具
  // v2 新增：场景路由
  scenes?: string[];       // 所属场景标签（如 "coding", "data", "web", "system"）
  priority?: number;       // 优先级 0-10（默认 5），低优先级工具在超限时先禁用
}

// --- Token Budget（7.3 节）---

export interface TokenBudgetConfig {
  maxTokens: number;
  nudgeThreshold: number;      // 剩余多少 token 时开始 nudge
  totalBudget: number;         // 当前会话总 token 上限
  usedTokens?: number;
}

// --- Hook 系统（5.2 节）---

export type HookName =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure";

export type PermissionDecision = "allow" | "deny" | "ask";

export interface ToolHookContext {
  toolName: string;
  arguments: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  isReadOnly: boolean;
  isDestructive: boolean;
  isConcurrencySafe: boolean;
  dangerousPatterns: string[];
}

export interface HookResult {
  decision: PermissionDecision;
  updatedInput?: Record<string, unknown>;  // 可修改参数
  blockingError?: string;                  // 阻止执行的原因
  preventContinuation?: boolean;          // 阻止 Agent 继续
  additionalContexts?: string[];           // 额外上下文
}

export type PreToolUseHandler = (ctx: ToolHookContext) => HookResult | Promise<HookResult>;
export type PostToolUseHandler = (ctx: ToolHookContext, result: ToolResult) => void | Promise<void>;
export type FailureHandler = (ctx: ToolHookContext, error: Error) => void | Promise<void>;
export type HookHandler = PreToolUseHandler;

// --- Speculative Classifier（3.2 节）---

export type ClassifierLabel = "safe" | "dangerous" | "ask";

export interface ClassifierResult {
  label: ClassifierLabel;
  reason?: string;
  patterns?: string[];
}

// --- Section-based System Prompt（2.4 / 2.5 节）---

export interface PromptSection {
  id: string;
  title: string;
  content: string;
  cacheable?: boolean;         // 是否可缓存（默认 true）
  cached?: boolean;            // 本轮是否已缓存
  dynamic?: boolean;           // 是否动态生成（每次重新计算）
}

export class PromptSectionRegistry {
  private sections: Map<string, PromptSection> = new Map();
  private order: string[] = [];

  register(section: PromptSection): void {
    this.sections.set(section.id, section);
    if (!this.order.includes(section.id)) this.order.push(section.id);
  }

  unregister(id: string): void {
    this.sections.delete(id);
    this.order = this.order.filter((s) => s !== id);
  }

  get(id: string): PromptSection | undefined {
    return this.sections.get(id);
  }

  getAll(): PromptSection[] {
    return this.order.map((id) => this.sections.get(id)!).filter(Boolean);
  }

  buildPrompt(): string {
    return this.getAll()
      .filter((s) => !s.cached)
      .map((s) => `【${s.title}】\n${s.content}`)
      .join("\n\n");
  }

  markCached(): void {
    this.getAll().forEach((s) => {
      if (s.cacheable !== false) s.cached = true;
    });
  }

  clearCache(): void {
    this.getAll().forEach((s) => (s.cached = false));
  }
}

// --- Permission Rule（5.1 节）---

export interface PermissionRule {
  pattern: RegExp;
  decision: PermissionDecision;
  message?: string;
}

// --- Verification Agent（4.3 节）---

export type VerificationVerdict = "PASS" | "FAIL" | "PARTIAL";

export interface VerificationResult {
  verdict: VerificationVerdict;
  details: string;
  steps: VerificationStep[];
}

export interface VerificationStep {
  description: string;
  passed: boolean;
  output?: string;
}

// --- Memory & Dream（8.2 / 8.3 节）---

export interface MemoryEntry {
  id: string;
  content: string;
  source: "user-feedback" | "auto-dream" | "git" | "manual";
  createdAt: number;
  importance: number;      // 0-1
  accessedAt?: number;
}

export interface AutoDreamConfig {
  enabled: boolean;
  turnThreshold: number;   // 多少轮后触发（默认 24）
  transcriptWindow?: number; // 取最近多少轮 transcript（默认 2-4）
}
