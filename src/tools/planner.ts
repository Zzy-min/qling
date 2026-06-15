// ============================================================
// 轻灵 - planner 工具
// 任务规划与分解，生成结构化执行计划
// ============================================================

import { ToolDefinition, ToolResult } from "../types.js";

export const plannerTool: ToolDefinition = {
  name: "planner",
  description:
    "Create a structured execution plan for complex tasks. Breaks down a goal into ordered steps with status tracking. Does not execute anything — only plans.",
  longDescription: `任务规划工具，将复杂目标分解为有序步骤。**不会执行任何操作**。

**使用场景**:
- 收到复杂任务时，先规划再执行
- 需要拆分子任务的场景（如多文件重构）
- 生成执行清单后逐步执行

**参数说明**:
- goal: 总体目标（一句话描述）
- steps: 步骤数组，每个步骤包含 description 和 priority
- 若不传 steps，则根据 goal 自动生成建议步骤

**输出**:
- 结构化计划，包含步骤编号、描述、优先级
- 可配合 todo 工具逐步跟踪执行`,
  parameters: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description: "Overall goal or task description",
      },
      steps: {
        type: "array",
        description: "Optional: array of step descriptions to organize into a plan",
        items: {
          type: "string",
        },
      },
    },
    required: ["goal"],
  },
  paramSchema: {
    goal: {
      type: "string",
      description: "总体目标描述。简洁说明要完成什么。",
      minLength: 5,
    },
    steps: {
      type: "array",
      description: "可选：步骤描述数组。若不提供，会根据 goal 自动生成建议步骤。",
      items: {
        type: "string",
        description: "单个步骤描述",
      },
    },
  },
  examples: [
    'planner goal="重构认证模块为 JWT"',
    'planner goal="部署应用到生产环境" steps=["构建项目","运行测试","推送镜像","更新服务"]',
  ],
  seeAlso: ["todo", "bash"],
  scenes: ["planning"],
  priority: 6,
  readOnly: true,
  destructive: false,
  concurrencySafe: true,
  effortHint: "minimal",
};

export async function runPlanner(args: {
  goal: string;
  steps?: string[];
}): Promise<ToolResult> {
  const steps = args.steps;

  if (steps && steps.length > 0) {
    // User provided steps — organize them
    const lines = steps.map((s, i) => {
      const num = String(i + 1).padStart(2, " ");
      return `  ${num}. ⬜ ${s}`;
    });
    const plan = [
      `📋 执行计划: ${args.goal}`,
      `─────────────────────────────`,
      ...lines,
      `─────────────────────────────`,
      `共 ${steps.length} 步。建议用 todo add 逐个添加后执行。`,
    ];
    return { tool_call_id: "", output: plan.join("\n") };
  }

  // Auto-generate suggested steps based on goal analysis
  const suggestions = generateSuggestions(args.goal);
  const plan = [
    `📋 执行计划: ${args.goal}`,
    `─────────────────────────────`,
    ...suggestions.map((s, i) => {
      const num = String(i + 1).padStart(2, " ");
      return `  ${num}. ⬜ ${s}`;
    }),
    `─────────────────────────────`,
    `建议: 用 todo add 将上述步骤添加到任务列表，然后逐步执行。`,
    `也可直接补充步骤: planner goal="${args.goal}" steps=["步骤1","步骤2",...]`,
  ];
  return { tool_call_id: "", output: plan.join("\n") };
}

function generateSuggestions(goal: string): string[] {
  const g = goal.toLowerCase();
  const steps: string[] = [];

  // Detect common task patterns
  if (/重构|refactor|重写|rewrite/i.test(g)) {
    steps.push("分析现有代码结构（read + search）");
    steps.push("确定重构范围和影响面");
    steps.push("编写重构方案（DESIGN.md）");
    steps.push("逐步实施重构");
    steps.push("运行测试验证");
    steps.push("清理无用代码");
  } else if (/部署|deploy|发布|release/i.test(g)) {
    steps.push("检查构建配置和环境变量");
    steps.push("运行完整测试套件");
    steps.push("构建生产版本");
    steps.push("部署到目标环境");
    steps.push("验证部署结果");
  } else if (/修复|fix|bug|错误/i.test(g)) {
    steps.push("定位问题（read 相关文件 + 搜索错误信息）");
    steps.push("分析根因");
    steps.push("实施修复");
    steps.push("编写或更新测试");
    steps.push("验证修复");
  } else if (/添加|add|新增|feature|功能/i.test(g)) {
    steps.push("理解需求和技术约束");
    steps.push("设计实现方案");
    steps.push("编写代码");
    steps.push("编写测试");
    steps.push("集成验证");
  } else if (/迁移|migrate|升级|upgrade/i.test(g)) {
    steps.push("评估迁移范围和风险");
    steps.push("制定迁移计划");
    steps.push("执行迁移（分批）");
    steps.push("测试兼容性");
    steps.push("清理旧版本依赖");
  } else {
    // Generic fallback
    steps.push("明确任务需求和约束");
    steps.push("搜索和阅读相关文件");
    steps.push("制定执行步骤");
    steps.push("逐步实施");
    steps.push("验证结果");
  }

  return steps;
}
