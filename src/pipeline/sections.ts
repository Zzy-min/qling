// ============================================================
// 轻灵 - Section-based System Prompt（参考 Claude Code 2.4/2.5 节）
// ============================================================

import { PromptSection, PromptSectionRegistry, AgentConfig } from "../types.js";

// --- 默认 Section IDs ---
export const SECTION_IDS = {
  INTRO: "intro",
  TOOLS: "tools",
  WORKFLOW: "workflow",
  RESTRICTIONS: "restrictions",
  TONE: "tone",
  TOKEN_BUDGET: "token_budget",
  SESSION: "session",
  MCP: "mcp",
  MEMORY: "memory",
  DYNAMIC: "dynamic",
} as const;

// --- 内置 Section Builders ---

export function buildIntroSection(name: string, version: string): PromptSection {
  return {
    id: SECTION_IDS.INTRO,
    title: "身份",
    content: `你是一个通用的命令行 Agent，名为"${name}" v${version}。你轻量、敏捷、专注。`,
    cacheable: true,
    cached: false,
  };
}

export function buildToolsSection(tools: AgentConfig["tools"]): PromptSection {
  const toolList = (tools ?? [])
    .map(
      (t) =>
        `• ${t.name}: ${t.description}${
          t.effortHint ? ` [effort: ${t.effortHint}]` : ""
        }`
    )
    .join("\n");

  return {
    id: SECTION_IDS.TOOLS,
    title: "工具列表",
    content: `你可用的工具：

${toolList}`,
    cacheable: true,
    cached: false,
  };
}

export function buildWorkflowSection(): PromptSection {
  return {
    id: SECTION_IDS.WORKFLOW,
    title: "工作流程",
    content: `【重要工作流程】收到任务时：
1. 先思考：这个任务需要几步？是否需要规划？
2. 如果任务复杂（超过2步），先用 todo add 依次列出执行步骤
3. 然后逐个执行：每完成一步用 todo done 标记
4. 所有步骤完成后返回清晰总结`,
    cacheable: true,
    cached: false,
  };
}

export function buildRestrictionsSection(): PromptSection {
  return {
    id: SECTION_IDS.RESTRICTIONS,
    title: "限制",
    content: `【工具使用原则】
- bash：执行命令、安装、构建、运行
- read：查看文件内容后再决定怎么写
- write：创建或覆盖文件
- todo：规划步骤、跟踪进度
- skill：遇到不熟悉的工具/API/框架时，用 skill 加载对应知识文件

【安全限制】
- 危险命令（rm -rf /、格式化磁盘等）会被自动拒绝
- 删除/覆盖操作前必须先读取确认
- 不确定的操作先问用户`,
    cacheable: true,
    cached: false,
  };
}

export function buildToneSection(): PromptSection {
  return {
    id: SECTION_IDS.TONE,
    title: "风格",
    content: `始终用中文回复，除非用户用英文。
当任务完成后，给出简洁的完成报告。
工具执行结果用 ✅（成功）或 ❌（失败）标记。`,
    cacheable: true,
    cached: false,
  };
}

export function buildSessionSection(): PromptSection {
  return {
    id: SECTION_IDS.SESSION,
    title: "会话",
    content: `当前会话可以用来：
- 记住项目上下文（当前工作目录、使用的技术栈）
- 记住用户的偏好设置
- 跨任务保持状态`,
    cacheable: false, // 动态，每次都重新生成
    dynamic: true,
    cached: false,
  };
}

export function buildMemorySection(): PromptSection {
  return {
    id: SECTION_IDS.MEMORY,
    title: "记忆",
    content: `【长期记忆】（从 ~/.qingling/memory/ 加载）
如无记忆则忽略此节。`,
    cacheable: false,
    dynamic: true,
    cached: false,
  };
}

export function buildTokenBudgetSection(usedTokens: number, maxTokens: number): PromptSection {
  const remaining = maxTokens - usedTokens;
  const pct = Math.round((remaining / maxTokens) * 100);

  return {
    id: SECTION_IDS.TOKEN_BUDGET,
    title: "Token 预算",
    content: `【Token 预算】
已使用: ~${usedTokens.toLocaleString()} tokens
剩余: ~${remaining.toLocaleString()} tokens (${pct}%)
当剩余低于 20% 时，主动精简回复，减少工具调用频率。`,
    cacheable: false,
    dynamic: true,
    cached: false,
  };
}

export function buildMCPSection(): PromptSection {
  return {
    id: SECTION_IDS.MCP,
    title: "MCP 服务器",
    content: `【MCP 服务器】
当前无可用 MCP 服务器。如有配置将在此处显示。`,
    cacheable: true,
    cached: false,
  };
}

// --- 默认 Registry Builder ---

export function buildDefaultRegistry(
  tools: AgentConfig["tools"],
  usedTokens: number = 0,
  maxTokens: number = 120_000
): PromptSectionRegistry {
  const registry = new PromptSectionRegistry();

  registry.register(buildIntroSection("轻灵", "0.2"));
  registry.register(buildToolsSection(tools));
  registry.register(buildWorkflowSection());
  registry.register(buildRestrictionsSection());
  registry.register(buildToneSection());
  registry.register(buildSessionSection());
  registry.register(buildMemorySection());
  registry.register(buildTokenBudgetSection(usedTokens, maxTokens));

  return registry;
}

// --- Prompt Builder Utility ---

export function buildSystemPrompt(
  registry: PromptSectionRegistry,
  dynamicSections?: { memory?: string; session?: string }
): string {
  // 更新动态 section
  const sessionSec = registry.get(SECTION_IDS.SESSION);
  if (sessionSec && dynamicSections?.session) {
    sessionSec.content = `【会话上下文】\n${dynamicSections.session}`;
  }

  const memorySec = registry.get(SECTION_IDS.MEMORY);
  if (memorySec && dynamicSections?.memory) {
    memorySec.content = `【长期记忆】（从 ~/.qingling/memory/ 加载）\n${dynamicSections.memory}`;
  } else if (memorySec) {
    memorySec.content = `【长期记忆】（从 ~/.qingling/memory/ 加载）\n如无记忆则忽略此节。`;
  }

  // 按顺序拼装
  return registry.buildPrompt();
}
