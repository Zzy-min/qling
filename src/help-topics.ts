export type HelpSurface = "slash" | "cli";

export interface HelpTopic {
  id: string;
  title: string;
  summary: string;
  aliases: string[];
  slashUsage: string;
  cliUsage: string;
  slashExamples: string[];
  cliExamples: string[];
  boundary: string;
}

export interface FocusedHelpOptions {
  surface?: HelpSurface;
  binName?: string;
}

interface HelpTopicSuggestion {
  topic: HelpTopic;
  alias: string;
  score: number;
}

const TOPICS: HelpTopic[] = [
  {
    id: "exports",
    title: "本地导出列表",
    summary: "查看 /export 已生成的本地 Markdown 会话导出，只展示文件元数据。",
    aliases: ["exports", "/exports", "导出列表", "/导出列表"],
    slashUsage: "/exports [count]",
    cliUsage: "{bin} exports [count]",
    slashExamples: ["/exports", "/exports 20", "/导出列表 20"],
    cliExamples: ["{bin} exports", "{bin} exports 20", "{bin} 导出列表 20"],
    boundary: "只读取本地文件元数据；不读取导出正文、不打开文件、不上传、不调用模型、不联网。",
  },
  {
    id: "permissions",
    title: "权限模式与决策解释",
    summary: "查看或切换本地工具权限默认策略，并解释指定工具会被 allow/ask/deny 的原因。",
    aliases: ["permissions", "/permissions", "权限", "/权限"],
    slashUsage: "/permissions [status|allow|deny|ask|explain <tool>]",
    cliUsage: "{bin} permissions [explain <tool>]",
    slashExamples: ["/permissions", "/permissions ask", "/permissions explain <tool>", "/权限 解释 <tool>"],
    cliExamples: ["{bin} permissions", "{bin} permissions explain <tool>", "{bin} 权限 解释 <tool>"],
    boundary: "只读取当前本地配置与环境变量；解释命令不执行工具、不修改配置、不调用模型、不联网。",
  },
  {
    id: "statusline",
    title: "本地状态线",
    summary: "展示模型、会话、分支、权限模式、上下文占用、成本估算和队列状态。",
    aliases: ["statusline", "/statusline", "状态线", "/状态线"],
    slashUsage: "/statusline [on|off]",
    cliUsage: "{bin} statusline",
    slashExamples: ["/statusline", "/statusline off", "/状态线"],
    cliExamples: ["{bin} statusline", "{bin} 状态线"],
    boundary: "读取本地运行时快照与配置；成本为本地估算，不调用模型、不联网。",
  },
  {
    id: "checkpoint",
    title: "本地会话检查点",
    summary: "手动保存当前会话快照，便于长任务或高风险改动前建立恢复点。",
    aliases: ["checkpoint", "/checkpoint", "检查点", "/检查点"],
    slashUsage: "/checkpoint [name] [--force]",
    cliUsage: "{bin} checkpoint [name] [--force]",
    slashExamples: ["/checkpoint", "/checkpoint before-refactor", "/checkpoint before-refactor --force", "/检查点 发布前"],
    cliExamples: ["{bin} checkpoint", "{bin} checkpoint before-refactor", "{bin} checkpoint release --session session-123", "{bin} checkpoint before-refactor --force", "{bin} 检查点 发布前"],
    boundary: "只写入本地 session 快照；默认不覆盖同名检查点；不读取无关会话正文、不调用模型、不联网、不上传。",
  },
  {
    id: "shortcuts",
    title: "TUI 输入快捷键",
    summary: "查看本地 TUI 输入编辑、历史搜索、队列和粘贴相关快捷键。",
    aliases: ["shortcuts", "/shortcuts", "快捷键", "/快捷键"],
    slashUsage: "/shortcuts",
    cliUsage: "{bin} shortcuts",
    slashExamples: ["/shortcuts", "/快捷键", "/help shortcuts"],
    cliExamples: ["{bin} shortcuts", "{bin} 快捷键", "{bin} help shortcuts"],
    boundary: "只读取本地静态快捷键说明；不读取会话正文、不修改输入缓冲、不调用模型、不联网。",
  },
  {
    id: "skill",
    title: "本地技能",
    summary: "列出、搜索或读取本地 skills 目录中的 Markdown 技能说明。",
    aliases: ["skill", "/skill", "技能", "/技能"],
    slashUsage: "/skill [list|search <query>|name]",
    cliUsage: "仅 slash：在当前交互会话中使用",
    slashExamples: ["/skill", "/skill list", "/skill search <query>", "/skill docker", "/技能 docker"],
    cliExamples: [],
    boundary: "只读取本地 skill Markdown 文件；不自动注入系统 prompt、不调用模型、不联网、不上传。",
  },
  {
    id: "doctor",
    title: "本地诊断",
    summary: "汇总配置、存储、MCP、hooks、daemon 与本地数据留存健康度。",
    aliases: ["doctor", "/doctor", "诊断", "/诊断"],
    slashUsage: "/doctor",
    cliUsage: "{bin} doctor",
    slashExamples: ["/doctor", "/诊断"],
    cliExamples: ["{bin} doctor", "{bin} 诊断"],
    boundary: "只做本地只读诊断；密钥脱敏，不修改配置、不调用模型。",
  },
  {
    id: "memory",
    title: "本地记忆",
    summary: "浏览、搜索本地记忆、上下文记忆来源、蒸馏实践与知识图谱摘要。",
    aliases: ["memory", "/memory", "记忆", "/记忆"],
    slashUsage: "/memory [count|search <query>|sources|practices|graph|show <id>]",
    cliUsage: "{bin} memory [status|search|sources|practices|graph|show]",
    slashExamples: ["/memory", "/memory sources", "/memory search 权限 5", "/记忆 图谱 5"],
    cliExamples: ["{bin} memory status", "{bin} memory sources", "{bin} memory search 权限 5", "{bin} 记忆 图谱 5"],
    boundary: "读取本地记忆索引和知识库摘要；默认不读取会话正文、不调用模型、不联网。",
  },
  {
    id: "dream",
    title: "本地记梦",
    summary: "从当前会话中抽取可沉淀信息并写入本地记忆。",
    aliases: ["dream", "/dream", "记梦", "/记梦", "沉淀", "/沉淀"],
    slashUsage: "/dream [count]",
    cliUsage: "仅 slash：在当前交互会话中使用",
    slashExamples: ["/dream", "/沉淀 8"],
    cliExamples: [],
    boundary: "只读取当前 user/assistant 消息；不输出正文、不读取工具消息、不调用模型、不联网。",
  },
  {
    id: "distill",
    title: "本地蒸馏",
    summary: "查看本地 distilled practices，复用已沉淀的成功路径。",
    aliases: ["distill", "/distill", "蒸馏", "/蒸馏", "经验", "/经验"],
    slashUsage: "/distill [count]",
    cliUsage: "{bin} memory practices [count]",
    slashExamples: ["/distill", "/蒸馏 5"],
    cliExamples: ["{bin} memory practices 5", "{bin} 记忆 经验 5"],
    boundary: "只读取本地 cognitive_knowledge.db 的蒸馏实践表；不读取会话正文、不调用模型、不联网。",
  },
  {
    id: "mission",
    title: "后台使命",
    summary: "管理后台 mission：启动、列表、查看、日志、附着、暂停、恢复、取消和重试。",
    aliases: ["mission", "/mission", "使命", "/使命"],
    slashUsage: "/mission [list|show|logs|pause|resume|cancel|retry] [id]",
    cliUsage: "{bin} mission <start|list|show|logs|attach|pause|resume|cancel|retry>",
    slashExamples: ["/mission list", "/mission show msn_123", "/使命 日志 msn_123"],
    cliExamples: ["{bin} mission list", "{bin} mission show msn_123", "{bin} 使命 列表"],
    boundary: "优先走本地 daemon/状态文件；管理命令正常退出，不读取会话正文。",
  },
  {
    id: "agents",
    title: "后台代理视图",
    summary: "按 Needs input / Working / Completed 分组查看本地后台任务。",
    aliases: ["agents", "/agents", "代理", "/代理"],
    slashUsage: "/agents",
    cliUsage: "{bin} agents",
    slashExamples: ["/agents", "/代理"],
    cliExamples: ["{bin} agents", "{bin} 代理"],
    boundary: "只读取本地 mission 元数据；不读取会话正文、不调用模型、不联网。",
  },
  {
    id: "goal",
    title: "目标驱动执行",
    summary: "设置、查看或清除当前/本地 session goal，让任务能跨轮推进。",
    aliases: ["goal", "/goal", "目标", "/目标"],
    slashUsage: "/goal [status|set <condition>|clear|daemon ...]",
    cliUsage: "{bin} goal <status|set|clear>",
    slashExamples: ["/goal status", "/goal set 所有测试通过", "/goal 所有测试通过", "/goal daemon clear", "/目标 设置 所有测试通过"],
    cliExamples: ["{bin} goal status", "{bin} goal set \"所有测试通过\"", "{bin} 目标 设置 \"所有测试通过\""],
    boundary: "本地保存目标条件和状态；不直接执行 destructive 操作。",
  },
  {
    id: "tasks",
    title: "本地任务",
    summary: "查看或取消 session loop/daemon 持久化任务。",
    aliases: ["tasks", "/tasks", "任务", "/任务"],
    slashUsage: "/tasks [cancel <id>|clear|daemon ...]",
    cliUsage: "{bin} tasks <list|cancel>",
    slashExamples: ["/tasks", "/tasks cancel tsk_123", "/任务 取消 tsk_123"],
    cliExamples: ["{bin} tasks list", "{bin} tasks cancel tsk_123", "{bin} 任务 取消 tsk_123"],
    boundary: "读取或更新本地任务元数据；取消只影响本地任务状态。",
  },
  {
    id: "recap",
    title: "本地会话回顾",
    summary: "从本地保存的会话快照生成简短回顾，方便重新接入上下文。",
    aliases: ["recap", "/recap", "回顾", "/回顾"],
    slashUsage: "/recap [count]",
    cliUsage: "{bin} recap [session|latest] [count]",
    slashExamples: ["/recap", "/回顾 5"],
    cliExamples: ["{bin} recap latest 5", "{bin} 回顾 5"],
    boundary: "只读取本地已保存会话快照；不调用模型、不联网。",
  },
];

function normalizeTopicName(value: string): string {
  return value.trim().replace(/^\/+/, "").toLowerCase();
}

function countTopicNameCharacters(value: string): number {
  return Array.from(value).length;
}

function calculateEditDistance(sourceValue: string, targetValue: string): number {
  const source = Array.from(sourceValue);
  const target = Array.from(targetValue);
  const initialRow = Array.from({ length: target.length + 1 }, (_, index) => index);
  const finalRow = source.reduce(
    (previousRow, sourceChar, sourceIndex) =>
      target.reduce(
        (currentRow, targetChar, targetIndex) => [
          ...currentRow,
          Math.min(
            currentRow[targetIndex] + 1,
            previousRow[targetIndex + 1] + 1,
            previousRow[targetIndex] + (sourceChar === targetChar ? 0 : 1),
          ),
        ],
        [sourceIndex + 1],
      ),
    initialRow,
  );

  return finalRow[target.length];
}

function scoreTopicAlias(input: string, alias: string): number {
  const normalizedInput = normalizeTopicName(input);
  const normalizedAlias = normalizeTopicName(alias);
  if (!normalizedInput || !normalizedAlias) return 0;
  if (normalizedInput === normalizedAlias) return 1;
  const inputLength = countTopicNameCharacters(normalizedInput);
  const aliasLength = countTopicNameCharacters(normalizedAlias);
  const maxLength = Math.max(inputLength, aliasLength);

  if (normalizedAlias.startsWith(normalizedInput) || normalizedInput.startsWith(normalizedAlias)) {
    return 1 - Math.abs(inputLength - aliasLength) / maxLength;
  }

  const distance = calculateEditDistance(normalizedInput, normalizedAlias);
  return 1 - distance / maxLength;
}

function renderTemplate(value: string, binName: string): string {
  return value.replaceAll("{bin}", binName);
}

export function findHelpTopic(rawTopic: string | undefined): HelpTopic | null {
  const normalized = normalizeTopicName(rawTopic ?? "");
  if (!normalized) return null;
  return TOPICS.find((topic) => topic.aliases.some((alias) => normalizeTopicName(alias) === normalized)) ?? null;
}

function findHelpTopicSuggestion(rawTopic: string | undefined): HelpTopicSuggestion | null {
  const normalized = normalizeTopicName(rawTopic ?? "");
  if (!normalized) return null;
  const threshold = 0.74;
  const suggestions = TOPICS.flatMap((topic) =>
    topic.aliases.map((alias) => ({
      topic,
      alias,
      score: scoreTopicAlias(normalized, alias),
    })),
  )
    .filter((suggestion) => suggestion.score >= threshold)
    .sort((left, right) => right.score - left.score || left.topic.id.localeCompare(right.topic.id));

  return suggestions[0] ?? null;
}

function formatHelpTopicSuggestion(suggestion: HelpTopicSuggestion, options: Required<FocusedHelpOptions>): string[] {
  if (options.surface === "cli") {
    return [
      `Suggest   : 你是不是想看 ${options.binName} help ${suggestion.topic.id}`,
      `Usage     : ${renderTemplate(suggestion.topic.cliUsage, options.binName)}`,
    ];
  }

  return [
    `Suggest   : 你是不是想看 /help ${suggestion.topic.id}`,
    `Usage     : ${suggestion.topic.slashUsage}`,
  ];
}

export function formatFocusedHelp(rawTopic: string | undefined, options: FocusedHelpOptions = {}): string[] {
  const surface = options.surface ?? "slash";
  const binName = options.binName ?? "qling";
  const topic = findHelpTopic(rawTopic);
  const fallback = surface === "cli" ? `${binName} help` : "/help";

  if (!topic) {
    const suggestion = findHelpTopicSuggestion(rawTopic);
    const suggestionLines = suggestion ? formatHelpTopicSuggestion(suggestion, { surface, binName }) : [];

    return [
      "",
      "🔎 聚焦帮助",
      "-----------------------------------------",
      `Status    : 未找到帮助主题 ${rawTopic ? `"${rawTopic}"` : "(empty)"}`,
      ...suggestionLines,
      `Next      : 使用 ${fallback} 查看全部命令。`,
      "边界      : 只查询本地静态帮助表；不读取状态、不调用模型、不联网。",
      "",
    ];
  }

  const usage = surface === "cli" ? renderTemplate(topic.cliUsage, binName) : topic.slashUsage;
  const primary = surface === "cli" ? topic.id : topic.slashUsage.split(/\s+/)[0];
  const aliases = surface === "cli"
    ? topic.aliases
        .filter((alias) => !alias.startsWith("/") && normalizeTopicName(alias) !== normalizeTopicName(primary))
        .map((alias) => renderTemplate(`${binName} ${alias}`, binName))
    : topic.aliases
        .filter((alias) => alias.startsWith("/") && normalizeTopicName(alias) !== normalizeTopicName(primary));
  const examples = surface === "cli" ? topic.cliExamples : topic.slashExamples;

  const lines = [
    "",
    "🔎 聚焦帮助",
    "-----------------------------------------",
    `Topic     : ${topic.id}`,
    `Title     : ${topic.title}`,
    `Summary   : ${topic.summary}`,
    `Usage     : ${usage}`,
    `Aliases   : ${aliases.length ? aliases.join(", ") : "-"}`,
    "Examples  :",
  ];

  for (const example of examples) {
    lines.push(`  - ${renderTemplate(example, binName)}`);
  }

  lines.push(`边界      : ${topic.boundary}`);
  lines.push("-----------------------------------------");
  lines.push("");
  return lines;
}
