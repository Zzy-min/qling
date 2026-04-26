// ============================================================
// 轻灵 - s07 Knowledge Agent（观察者模式）
// 参考 Microsoft AI Agents for Beginners Lesson 13 & 14
// 将 AutoDream 升级为知识观察者，主动学习项目上下文
// ============================================================

import { ToolCall, ToolResult, Message, MemoryEntry } from "./types.js";
import { MemoryStore } from "./memory.js";

// --- 知识观察者：观察对话和工具执行，提取结构化知识 ---

export interface Observation {
  type: "tool_use" | "file_created" | "file_modified" | "error" | "concept" | "decision";
  content: string;
  metadata?: Record<string, string>;
  timestamp: number;
  confidence: number; // 0-1
}

export interface KnowledgeItem {
  id: string;
  observation: Observation;
  promoted: boolean;
  tags: string[];
}

// --- 工具使用模式库 ---
const TOOL_USE_PATTERNS = [
  // Git 操作
  { tool: "bash", pattern: /\b(git\s+(add|commit|push|pull|merge|rebase|clone))\b/, tag: "git" },
  // 包管理
  { tool: "bash", pattern: /\b(npm\s+(install|run|test|build)|pip\s+install|yarn\s+(add|install))\b/, tag: "package-manager" },
  // Docker
  { tool: "bash", pattern: /\b(docker\s+(build|run|pull|ps|exec|logs))\b/, tag: "docker" },
  // Kubernetes
  { tool: "bash", pattern: /\b(kubectl\s+(get|apply|describe|logs|exec))\b/, tag: "kubernetes" },
  // Python
  { tool: "bash", pattern: /\b(python3?|pip3?|uv\s+)/, tag: "python" },
  // TypeScript
  { tool: "bash", pattern: /\b(npx|tsc|yarn\s+(dev|build))\b/, tag: "typescript" },
  // 文件操作
  { tool: "bash", pattern: /\b(ls|mkdir|rm|cp|mv|chmod|chown)\b/, tag: "file-ops" },
  // 进程/服务
  { tool: "bash", pattern: /\b(ps|kill|pkill|grep|top|htop)\b/, tag: "process" },
];

// --- 文件变化模式 ---
const FILE_CREATED_PATTERNS = [
  /文件已写入:\s*(.+)/,
  /✅.*已创建:\s*(.+)/,
  /created:\s*(.+)/i,
];

const FILE_MODIFIED_PATTERNS = [
  /修改了\s*(.+)/,
  /updated:\s*(.+)/i,
  /patched:\s*(.+)/i,
];

// --- 错误模式 ---
const ERROR_PATTERNS = [
  { pattern: /Error:\s*(.+)/i, tag: "generic-error" },
  { pattern: /Traceback\s*\([^)]*\):\s*(.+)/i, tag: "python-error" },
  { pattern: /SyntaxError:\s*(.+)/i, tag: "syntax-error" },
  { pattern: /NotADirectoryError/i, tag: "path-error" },
  { pattern: /WinError:\s*(.+)/i, tag: "windows-error" },
  { pattern: /ModuleNotFoundError:\s*(.+)/i, tag: "import-error" },
];

export class KnowledgeObserver {
  private observations: Observation[] = [];
  private pendingItems: KnowledgeItem[] = [];
  private memoryStore: MemoryStore;
  private turnCount: number = 0;
  private toolUseCounts: Map<string, number> = new Map();
  private errorCounts: Map<string, number> = new Map();

  constructor(memoryStore: MemoryStore) {
    this.memoryStore = memoryStore;
  }

  // --- 观察用户消息 ---
  observeUserMessage(content: string): void {
    this.turnCount++;

    // 提取概念和决策
    const conceptPatterns = [
      /(?:使用|采用)\s+(\S+)\s+(?:框架|库|工具|方案)/g,
      /(?:决定|选定)\s+(\S+)/g,
      /(?:目标|计划)\s+[:-]\s*(.+)/g,
    ];

    for (const pat of conceptPatterns) {
      let match;
      while ((match = pat.exec(content)) !== null) {
        this.addObservation({
          type: "concept",
          content: `用户提到: ${match[1].trim()}`,
          timestamp: Date.now(),
          confidence: 0.7,
        });
      }
    }

    // 观察是否有明确的决策
    if (/决定|选定|采用|选择|不|不要/i.test(content)) {
      this.addObservation({
        type: "decision",
        content: content.slice(0, 200),
        timestamp: Date.now(),
        confidence: 0.8,
      });
    }
  }

  // --- 观察工具调用 ---
  observeToolCall(toolCall: ToolCall): void {
    const toolName = toolCall.name;

    // 记录工具使用次数
    this.toolUseCounts.set(toolName, (this.toolUseCounts.get(toolName) ?? 0) + 1);

    // 提取工具使用模式
    for (const entry of TOOL_USE_PATTERNS) {
      if (entry.tool !== toolName) continue;
      const cmd = String(toolCall.arguments.command ?? "");
      const match = entry.pattern.exec(cmd);
      if (match) {
        this.addObservation({
          type: "tool_use",
          content: `使用 ${entry.tag}: ${cmd.slice(0, 100)}`,
          metadata: { tool: toolName, tag: entry.tag, command: cmd.slice(0, 100) },
          timestamp: Date.now(),
          confidence: 0.9,
        });
      }
    }

    // 文件路径提取
    const pathPatterns = [
      /([\/.a-zA-Z0-9_-]+\.(ts|js|py|json|md|yaml|yml|sh|bash))/g,
    ];
    for (const pat of pathPatterns) {
      let match;
      const argsStr = JSON.stringify(toolCall.arguments);
      while ((match = pat.exec(argsStr)) !== null) {
        this.addObservation({
          type: "file_modified",
          content: `涉及文件: ${match[1]}`,
          metadata: { file: match[1] },
          timestamp: Date.now(),
          confidence: 0.8,
        });
      }
    }
  }

  // --- 观察工具结果 ---
  observeToolResult(result: ToolResult, toolName: string): void {
    if (result.is_error) {
      // 错误观察
      for (const ep of ERROR_PATTERNS) {
        const match = ep.pattern.exec(result.output);
        if (match) {
          const tag = ep.tag;
          this.errorCounts.set(tag, (this.errorCounts.get(tag) ?? 0) + 1);

          this.addObservation({
            type: "error",
            content: `错误 [${tag}]: ${match[1].slice(0, 150)}`,
            metadata: { errorType: tag, errorDetail: match[1].slice(0, 150) },
            timestamp: Date.now(),
            confidence: 0.9,
          });
        }
      }
    } else {
      // 成功结果 — 检查是否有文件创建
      for (const pat of FILE_CREATED_PATTERNS) {
        const match = pat.exec(result.output);
        if (match) {
          this.addObservation({
            type: "file_created",
            content: `创建文件: ${match[1]}`,
            metadata: { file: match[1] },
            timestamp: Date.now(),
            confidence: 0.85,
          });
        }
      }
    }
  }

  // --- 观察 assistant 回复 ---
  observeAssistantMessage(content: string): void {
    // 检查是否提到了某个工具的使用意图
    const toolMentions = content.match(/\b(read|write|bash|todo|skill)\b/g);
    if (toolMentions) {
      const unique = Array.from(new Set(toolMentions));
      this.addObservation({
        type: "tool_use",
        content: `助手计划使用工具: ${unique.join(", ")}`,
        metadata: { plannedTools: unique.join(",") },
        timestamp: Date.now(),
        confidence: 0.5, // 低置信度，因为只是计划
      });
    }
  }

  // --- 主动观察：从记忆获取上下文 ---
  getContextualObservations(query: string, limit: number = 5): Observation[] {
    const keywords = query.toLowerCase().split(/\s+/);
    const scored = this.observations.map((obs) => {
      let score = obs.confidence;
      const content = obs.content.toLowerCase();
      for (const kw of keywords) {
        if (content.includes(kw)) score += 0.2;
      }
      return { obs, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.obs);
  }

  // --- 定期将观察提升为记忆 ---
  async promoteToMemory(force: boolean = false): Promise<number> {
    const threshold = this.turnCount > 0 ? Math.max(5, this.turnCount / 4) : 5;

    if (!force && this.turnCount < threshold) {
      return 0;
    }

    const highConfidence = this.observations.filter(
      (o) => o.confidence >= 0.8 && !this.isAlreadyInMemory(o)
    );

    let promoted = 0;
    for (const obs of highConfidence) {
      const tags = this.extractTags(obs);
      this.memoryStore.add(
        `[知识观察] ${obs.content}`,
        "auto-dream",
        obs.confidence
      );
      promoted++;
    }

    if (promoted > 0) {
      await this.memoryStore.saveToDisk();
    }

    return promoted;
  }

  // --- 生成观察报告 ---
  generateReport(): string {
    const lines: string[] = [];

    lines.push(`📊 知识观察报告（第 ${this.turnCount} 轮）`);
    lines.push("");

    // 工具使用统计
    if (this.toolUseCounts.size > 0) {
      lines.push("🔧 工具使用统计:");
      const sorted = Array.from(this.toolUseCounts.entries()).sort(
        (a, b) => b[1] - a[1]
      );
      for (const [tool, count] of sorted) {
        lines.push(`  • ${tool}: ${count} 次`);
      }
      lines.push("");
    }

    // 错误统计
    if (this.errorCounts.size > 0) {
      lines.push("❌ 错误统计:");
      for (const [err, count] of Array.from(this.errorCounts.entries())) {
        lines.push(`  • ${err}: ${count} 次`);
      }
      lines.push("");
    }

    // 最近观察
    if (this.observations.length > 0) {
      lines.push("🧠 最近观察:");
      const recent = this.observations.slice(-5).reverse();
      for (const obs of recent) {
        const icon = obs.type === "error" ? "❌" : obs.type === "tool_use" ? "🔧" : obs.type === "concept" ? "💡" : "📄";
        lines.push(`  ${icon} ${obs.content.slice(0, 80)}`);
      }
    }

    return lines.join("\n");
  }

  // --- Private ---

  private addObservation(obs: Observation): void {
    // 去重
    const exists = this.observations.some(
      (o) => o.content === obs.content && o.type === obs.type
    );
    if (!exists) {
      this.observations.push(obs);
      // 保留最近 200 条观察
      if (this.observations.length > 200) {
        this.observations = this.observations.slice(-200);
      }
    }
  }

  private extractTags(obs: Observation): string[] {
    const tags: string[] = [];
    if (obs.metadata) {
      if (obs.metadata.tag) tags.push(obs.metadata.tag);
      if (obs.metadata.errorType) tags.push(obs.metadata.errorType);
      if (obs.metadata.plannedTools) {
        tags.push(...obs.metadata.plannedTools.split(","));
      }
    }
    return tags;
  }

  private isAlreadyInMemory(obs: Observation): boolean {
    // 简单检查 content 是否已在持久化记忆中
    // 这个检查应该在 MemoryStore.getRelevant 中已有实现
    return false; // 保守返回 false
  }
}

// --- 与 AgentLoop 集成的观察者适配器 ---

export class KnowledgeAgentAdapter {
  private observer: KnowledgeObserver;
  private memoryStore: MemoryStore;
  private reportInterval: number = 10; // 每 N 轮输出一次报告

  constructor(memoryStore: MemoryStore) {
    this.memoryStore = memoryStore;
    this.observer = new KnowledgeObserver(memoryStore);
  }

  // 在每次 user message 后调用
  onUserMessage(content: string): void {
    this.observer.observeUserMessage(content);
  }

  // 在每次 tool call 前调用
  onToolCall(toolCall: ToolCall): void {
    this.observer.observeToolCall(toolCall);
  }

  // 在每次 tool result 后调用
  onToolResult(result: ToolResult, toolName: string): void {
    this.observer.observeToolResult(result, toolName);
  }

  // 在每次 assistant message 后调用
  onAssistantMessage(content: string): void {
    this.observer.observeAssistantMessage(content);
  }

  // 在每个 turn 结束时调用（由 AgentLoop 调用）
  async onTurnEnd(turnCount: number): Promise<void> {
    if (turnCount % this.reportInterval === 0) {
      const report = this.observer.generateReport();
      console.error(`\n${report}\n`);
    }

    // 每 20 轮自动将观察提升为记忆
    if (turnCount % 20 === 0) {
      const promoted = await this.observer.promoteToMemory(false);
      if (promoted > 0) {
        console.error(`💾 [KnowledgeAgent] 已将 ${promoted} 条观察提升为记忆`);
      }
    }
  }

  getObserver(): KnowledgeObserver {
    return this.observer;
  }
}
