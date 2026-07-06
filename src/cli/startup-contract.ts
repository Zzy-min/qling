import type { CliGlobalOptions } from "../config.js";
import { formatFocusedHelp } from "../help-topics.js";
import { formatLocalGuidancePanel } from "./guidance-panel.js";
import { getLocalizedText } from "../i18n/index.js";

export type CliMode = "help" | "run" | "chat" | "repl" | "workflow" | "memory" | "dashboard" | "discovery" | "setup" | "bootstrap" | "mission" | "daemon" | "agents" | "logs" | "doctor" | "status" | "storage" | "exports" | "sessions" | "checkpoint" | "tasks" | "goal" | "privacy" | "context" | "shortcuts" | "statusline" | "recap" | "permissions" | "config" | "mcp" | "hooks";

const KNOWN_MODES: CliMode[] = ["help", "run", "chat", "repl", "workflow", "memory", "dashboard", "discovery", "setup", "bootstrap", "mission", "daemon", "agents", "logs", "doctor", "status", "storage", "exports", "sessions", "checkpoint", "tasks", "goal", "privacy", "context", "shortcuts", "statusline", "recap", "permissions", "config", "mcp", "hooks"];
const MANAGEMENT_MODES: CliMode[] = ["help", "workflow", "memory", "dashboard", "discovery", "setup", "bootstrap", "mission", "daemon", "agents", "logs", "doctor", "status", "storage", "exports", "sessions", "checkpoint", "tasks", "goal", "privacy", "context", "shortcuts", "statusline", "recap", "permissions", "config", "mcp", "hooks"];
const TOP_LEVEL_MODE_ALIASES: Record<string, CliMode> = {
  "帮助": "help",
  "启动": "bootstrap",
  "初始化": "bootstrap",
  "诊断": "doctor",
  "状态": "status",
  "存储": "storage",
  "导出列表": "exports",
  "会话列表": "sessions",
  "检查点": "checkpoint",
  "任务": "tasks",
  "目标": "goal",
  "隐私": "privacy",
  "上下文": "context",
  "快捷键": "shortcuts",
  "状态线": "statusline",
  "回顾": "recap",
  "权限": "permissions",
  "配置": "config",
  "MCP": "mcp",
  "外部工具": "mcp",
  "钩子": "hooks",
  "记忆": "memory",
  "使命": "mission",
  "代理": "agents",
  "日志": "logs",
};

interface TopLevelCommandSuggestion {
  command: string;
  helpTopic: string;
  score: number;
}

interface TopLevelCommandCandidate {
  command: string;
  helpTopic: string;
  rank: number;
}

const TOP_LEVEL_COMMAND_SUGGESTION_THRESHOLD = 0.74;
const TOP_LEVEL_COMMAND_CANDIDATES: TopLevelCommandCandidate[] = [
  ...KNOWN_MODES.map((mode) => ({ command: mode, helpTopic: mode, rank: 0 })),
  ...Object.keys(TOP_LEVEL_MODE_ALIASES).map((alias) => ({
    command: alias,
    helpTopic: alias,
    rank: 1,
  })),
];

function resolveTopLevelMode(arg: string): CliMode | null {
  if ((KNOWN_MODES as string[]).includes(arg)) {
    return arg as CliMode;
  }
  return TOP_LEVEL_MODE_ALIASES[arg] ?? null;
}

function isManagementMode(mode: CliMode | null | undefined): boolean {
  return !!mode && MANAGEMENT_MODES.includes(mode);
}

function isHelpFlag(arg: string): boolean {
  return arg === "--help" || arg === "-h";
}

function resolveHelpTopicArgs(mode: CliMode | null, positional: string[]): string[] {
  if (mode && mode !== "help" && isManagementMode(mode)) {
    return [mode];
  }
  if (positional.length > 0) {
    return [positional.join(" ")];
  }
  return [];
}

function normalizeCommandName(value: string): string {
  return value.trim().replace(/^\/+/, "").toLowerCase();
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

function countCommandNameCharacters(value: string): number {
  return Array.from(value).length;
}

function scoreCommandCandidate(input: string, candidate: string): number {
  const normalizedInput = normalizeCommandName(input);
  const normalizedCandidate = normalizeCommandName(candidate);
  if (!normalizedInput || !normalizedCandidate) return 0;
  if (normalizedInput === normalizedCandidate) return 1;
  const inputLength = countCommandNameCharacters(normalizedInput);
  const candidateLength = countCommandNameCharacters(normalizedCandidate);
  const maxLength = Math.max(inputLength, candidateLength);

  if (normalizedCandidate.startsWith(normalizedInput) || normalizedInput.startsWith(normalizedCandidate)) {
    return 1 - Math.abs(inputLength - candidateLength) / maxLength;
  }

  const distance = calculateEditDistance(normalizedInput, normalizedCandidate);
  return 1 - distance / maxLength;
}

function findTopLevelCommandSuggestion(input: string): TopLevelCommandSuggestion | null {
  if (!input.trim() || input.startsWith("-")) return null;

  const suggestions = TOP_LEVEL_COMMAND_CANDIDATES.map((candidate) => ({
    ...candidate,
    score: scoreCommandCandidate(input, candidate.command),
  }))
    .filter((suggestion) => suggestion.score >= TOP_LEVEL_COMMAND_SUGGESTION_THRESHOLD)
    .sort((left, right) => right.score - left.score || left.rank - right.rank || left.command.localeCompare(right.command));

  const best = suggestions[0];
  if (!best) return null;
  return { command: best.command, helpTopic: best.helpTopic, score: best.score };
}

function quoteTaskForRun(task: string): string {
  return `"${task.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatTopLevelCommandSuggestion(input: string, suggestion: TopLevelCommandSuggestion): string {
  return formatLocalGuidancePanel({
    title: `未知命令: ${input}`,
    reason: "输入看起来像命令，但不是轻灵已注册的顶层命令。",
    next: `你是不是想用: qling ${suggestion.command}`,
    example: `qling help ${suggestion.helpTopic} 或 qling run ${quoteTaskForRun(input)}`,
    boundary: getLocalizedText().boundaries.localNoModel,
  });
}

export interface CliResolutionOk {
  kind: "ok";
  mode: CliMode;
  task?: string;
  subArgs: string[];
  global: CliGlobalOptions;
  warnings: string[];
}

export interface CliResolutionErr {
  kind: "error";
  code:
    | "CLI_INVALID_MODE_COMBINATION"
    | "CLI_MISSING_TASK"
    | "CLI_INVALID_OPTION_VALUE"
    | "CLI_UNKNOWN_COMMAND_SUGGESTION";
  message: string;
  exitCode: 2;
}

export type CliResolution = CliResolutionOk | CliResolutionErr;

export function formatCliError(code: string, message: string): string {
  return message.includes("\n原因:")
    ? `Error: [${code}]\n${message}`
    : `Error: [${code}]\n${formatLocalGuidancePanel({
      title: message,
      reason: "命令参数组合或取值不符合轻灵 CLI 约定。",
      next: "运行 `qling help` 查看可用命令，或改用推荐的新手路径。",
      example: "qling help",
      boundary: getLocalizedText().boundaries.localValidation,
    })}`;
}

export function parseCliArgs(args: string[]): CliResolution {
  const global: CliGlobalOptions = {};
  const warnings: string[] = [];
  const positional: string[] = [];
  const subArgs: string[] = [];

  let hasHelp = false;
  let modeFromSubcommand: CliMode | null = null;
  let modeFromAliasChat = false;
  let modeFromAliasRepl = false;
  let onceTask: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (isHelpFlag(arg)) {
      hasHelp = true;
      continue;
    }

    if (!arg.startsWith("-") && modeFromSubcommand === null && positional.length === 0) {
      const resolvedMode = resolveTopLevelMode(arg);
      if (resolvedMode) {
        modeFromSubcommand = resolvedMode;
        if (isManagementMode(resolvedMode)) {
          subArgs.push(...args.slice(i + 1));
          break;
        }
        continue;
      }
    }

    if (arg === "--tui" || arg === "-t") {
      modeFromAliasChat = true;
      warnings.push("`--tui` is deprecated, use `qling chat` instead.");
      continue;
    }
    if (arg === "--repl" || arg === "-r") {
      modeFromAliasRepl = true;
      warnings.push("`--repl` is deprecated, use `qling repl` instead.");
      continue;
    }
    if (arg === "--once") {
      const next = args[i + 1];
      if (!next) {
        return {
          kind: "error",
          code: "CLI_MISSING_TASK",
          message: formatLocalGuidancePanel({
            title: "缺少任务内容",
            reason: "`--once` 后面需要一个任务字符串。",
            next: "改用推荐形式 `qling run \"任务\"`。",
            example: "qling run \"分析这个仓库\"",
            boundary: getLocalizedText().boundaries.localValidation,
          }),
          exitCode: 2,
        };
      }
      onceTask = next;
      warnings.push("`--once` is deprecated, use `qling run \"task\"` instead.");
      i++;
      continue;
    }
    if (arg.startsWith("--once=")) {
      const value = arg.slice("--once=".length).trim();
      if (!value) {
        return {
          kind: "error",
          code: "CLI_MISSING_TASK",
          message: formatLocalGuidancePanel({
            title: "缺少任务内容",
            reason: "`--once` 后面需要一个非空任务字符串。",
            next: "改用推荐形式 `qling run \"任务\"`。",
            example: "qling run \"分析这个仓库\"",
            boundary: getLocalizedText().boundaries.localValidation,
          }),
          exitCode: 2,
        };
      }
      onceTask = value;
      warnings.push("`--once` is deprecated, use `qling run \"task\"` instead.");
      continue;
    }

    if (arg === "--no-workspace") {
      global.noWorkspace = true;
      continue;
    }
    if (arg === "--continue") {
      global.continueSession = true;
      continue;
    }
    if (arg === "--resume" || arg.startsWith("--resume=")) {
      const resume = parseResumeOption(args, i, arg);
      if (resume.error) {
        return {
          kind: "error",
          code: resume.error.code,
          message: resume.error.message,
          exitCode: 2,
        };
      }
      global.resumeSession = resume.value;
      if (resume.consumeNext) i++;
      continue;
    }
    if (arg === "--inspect-prompt") {
      global.inspectPrompt = true;
      continue;
    }
    if (arg === "--inspect-request") {
      global.inspectRequest = true;
      continue;
    }

    const maybeErr = parseValueOption(args, i, arg, global);
    if (maybeErr) {
      if (maybeErr.consumeNext) i++;
      if (maybeErr.error) {
        return {
          kind: "error",
          code: maybeErr.error.code,
          message: maybeErr.error.message,
          exitCode: 2,
        };
      }
      continue;
    }

    positional.push(arg);
  }

  if (hasHelp) {
    return { kind: "ok", mode: "help", subArgs: resolveHelpTopicArgs(modeFromSubcommand, positional), global, warnings };
  }

  if (modeFromSubcommand && modeFromSubcommand !== "help" && isManagementMode(modeFromSubcommand) && subArgs.some(isHelpFlag)) {
    return { kind: "ok", mode: "help", subArgs: [modeFromSubcommand], global, warnings };
  }

  if (global.continueSession && global.resumeSession) {
    return {
      kind: "error",
      code: "CLI_INVALID_MODE_COMBINATION",
      message: "`--continue` and `--resume <session>` are mutually exclusive.",
      exitCode: 2,
    };
  }

  const hasOnce = onceTask !== null;
  const hasPositional = positional.length > 0;
  const hasModeByAlias = modeFromAliasChat || modeFromAliasRepl;
  const explicitModeCount =
    (modeFromSubcommand ? 1 : 0) + (modeFromAliasChat ? 1 : 0) + (modeFromAliasRepl ? 1 : 0) + (hasOnce ? 1 : 0);

  if (explicitModeCount > 1) {
    return {
      kind: "error",
      code: "CLI_INVALID_MODE_COMBINATION",
      message:
        "modes are mutually exclusive. Use one of: run | chat | repl | --tui | --repl | --once \"task\" | \"task\"",
      exitCode: 2,
    };
  }

  if (modeFromSubcommand === "run") {
    if (global.continueSession || global.resumeSession) {
      return {
        kind: "error",
        code: "CLI_INVALID_MODE_COMBINATION",
        message: "`--continue/--resume` only work in interactive chat/repl modes.",
        exitCode: 2,
      };
    }
    const task = onceTask ?? positional.join(" ").trim();
    if (!task) {
      return {
        kind: "error",
        code: "CLI_MISSING_TASK",
        message: formatLocalGuidancePanel({
          title: "缺少任务内容",
          reason: "`run` 需要一个任务字符串。",
          next: "在命令后写清楚要执行的任务。",
          example: "qling run \"分析这个仓库\"",
          boundary: getLocalizedText().boundaries.localValidation,
        }),
        exitCode: 2,
      };
    }
    return { kind: "ok", mode: "run", task, subArgs: [], global, warnings };
  }

  if (isManagementMode(modeFromSubcommand)) {
    if (global.continueSession || global.resumeSession) {
      return {
        kind: "error",
        code: "CLI_INVALID_MODE_COMBINATION",
        message: "`--continue/--resume` only work in interactive chat/repl modes.",
        exitCode: 2,
      };
    }
    return { kind: "ok", mode: modeFromSubcommand!, subArgs, global, warnings };
  }

  if (modeFromSubcommand === "chat") {
    if (hasPositional) {
      return {
        kind: "error",
        code: "CLI_INVALID_MODE_COMBINATION",
        message: "`chat` mode does not accept a one-shot task. Use `qling run \"task\"`.",
        exitCode: 2,
      };
    }
    return { kind: "ok", mode: "chat", subArgs: [], global, warnings };
  }

  if (modeFromSubcommand === "repl") {
    if (hasPositional) {
      return {
        kind: "error",
        code: "CLI_INVALID_MODE_COMBINATION",
        message: "`repl` mode does not accept a one-shot task. Use `qling run \"task\"`.",
        exitCode: 2,
      };
    }
    return { kind: "ok", mode: "repl", subArgs: [], global, warnings };
  }

  if (modeFromAliasChat) {
    if (hasPositional) {
      return {
        kind: "error",
        code: "CLI_INVALID_MODE_COMBINATION",
        message: "`--tui` mode does not accept a one-shot task. Use `qling run \"task\"`.",
        exitCode: 2,
      };
    }
    return { kind: "ok", mode: "chat", subArgs: [], global, warnings };
  }

  if (modeFromAliasRepl) {
    if (hasPositional) {
      return {
        kind: "error",
        code: "CLI_INVALID_MODE_COMBINATION",
        message: "`--repl` mode does not accept a one-shot task. Use `qling run \"task\"`.",
        exitCode: 2,
      };
    }
    return { kind: "ok", mode: "repl", subArgs: [], global, warnings };
  }

  if (hasOnce) {
    if (global.continueSession || global.resumeSession) {
      return {
        kind: "error",
        code: "CLI_INVALID_MODE_COMBINATION",
        message: "`--continue/--resume` only work in interactive chat/repl modes.",
        exitCode: 2,
      };
    }
    return { kind: "ok", mode: "run", task: onceTask!, subArgs: [], global, warnings };
  }

  if (hasPositional) {
    if (global.continueSession || global.resumeSession) {
      return {
        kind: "error",
        code: "CLI_INVALID_MODE_COMBINATION",
        message: "`--continue/--resume` only work in interactive chat/repl modes.",
        exitCode: 2,
      };
    }
    if (positional.length === 1) {
      const suggestion = findTopLevelCommandSuggestion(positional[0]);
      if (suggestion) {
        return {
          kind: "error",
          code: "CLI_UNKNOWN_COMMAND_SUGGESTION",
          message: formatTopLevelCommandSuggestion(positional[0], suggestion),
          exitCode: 2,
        };
      }
    }
    warnings.push("positional one-shot form is deprecated, prefer `qling run \"task\"`.");
    return { kind: "ok", mode: "run", task: positional.join(" "), subArgs: [], global, warnings };
  }

  return { kind: "ok", mode: "chat", subArgs: [], global, warnings };
}

export function buildHelpText(binName = "qling", topic?: string): string {
  if (topic?.trim()) {
    return formatFocusedHelp(topic, { surface: "cli", binName }).join("\n");
  }

  return `
${binName} - 通用 CLI Agent

新手路径:
  ${binName} bootstrap                # 本机一键启动检查：目录、配置、诊断和下一步
  ${binName} setup                    # 快速配置 Provider / Model / Endpoint（密钥放系统环境变量）
  ${binName} run "分析这个仓库"        # 单次执行，验证模型和工具链
  ${binName}                          # 进入 TUI，输入 / 打开命令面板
  ${binName} doctor                   # 本地诊断
  ${binName} privacy                  # 查看本地数据边界

主要用法:
  ${binName}                          # 默认进入流式 TUI（chat）
  ${binName} chat                     # 显式进入流式 TUI
  ${binName} --continue               # 恢复最近一次交互会话
  ${binName} --resume <session>       # 恢复指定交互会话
  ${binName} repl                     # 简易 REPL
  ${binName} run "你的任务"            # 单次执行（推荐）
  ${binName} bootstrap                # 本机一键启动检查
  ${binName} setup                    # 快速配置 LLM 提供商（不保存 API key 到 .env）
  ${binName} help                     # 显示帮助

管理命令 (v0.3):
  ${binName} daemon start             # 启动后台守护进程
  ${binName} daemon status            # 查看守护进程状态
  ${binName} daemon stop              # 停止后台守护进程
  ${binName} doctor                   # 本地稳定性与数据留存诊断
  ${binName} status                   # 查看本地状态摘要
  ${binName} storage                  # 只读盘点本地 state/sessions/exports/cache
  ${binName} exports [count]          # 查看本地 Markdown 会话导出
  ${binName} sessions [count]         # 查看本地保存的会话快照
  ${binName} checkpoint [name]        # 复制最近会话为本地恢复检查点
  ${binName} tasks list [count]       # 查看本地持久化 loop/daemon 任务
  ${binName} tasks cancel <id>        # 取消本地持久化任务
  ${binName} goal status [session]    # 查看本地 session goal 状态
  ${binName} goal set "完成条件"       # 为最近会话设置 daemon goal
  ${binName} goal clear [session]     # 清除本地 session goal
  ${binName} privacy                  # 查看本地数据留存路径与隐私边界
  ${binName} context                  # 查看本地上下文与快照状态
  ${binName} shortcuts                # 查看 TUI 输入快捷键
  ${binName} statusline               # 查看本地状态线
  ${binName} recap [session|latest] [count] # 查看本地保存会话回顾
  ${binName} permissions              # 查看本地权限默认策略与规则
  ${binName} permissions explain <tool> # 解释指定工具的权限决策
  ${binName} config                   # 查看本地配置摘要（密钥脱敏）
  ${binName} mcp                      # 查看本地 MCP server 配置摘要
  ${binName} hooks                    # 查看本地 hooks/guard 配置摘要
  ${binName} agents                   # 按状态分组查看后台任务
  ${binName} 代理                     # agents 的中文别名
  ${binName} logs <id>                # 查看特定使命日志（top-level alias）
  ${binName} 日志 <id>                # logs 的中文别名
  ${binName} workflow resume <id>     # 从状态机 Checkpoint 恢复执行
  ${binName} memory status [count]    # 查看本地持久化记忆索引
  ${binName} memory list [count]      # memory status 的列表别名
  ${binName} memory search <query> [count] # 搜索本地持久化记忆
  ${binName} memory sources           # 查看本地上下文记忆来源与边界
  ${binName} memory practices [count] # 查看本地蒸馏实践摘要
  ${binName} memory graph [count]     # 查看本地知识图谱节点摘要
  ${binName} memory show <id>         # 查看指定本地记忆详情
  ${binName} memory reindex [--full]  # 重新构建语义记忆向量索引
  ${binName} dashboard start [--port] # 启动本地白盒化观测控制台
  ${binName} discovery sync           # 同步动态插件与技能

使命管理 (v0.5 M2):
  ${binName} mission start "任务"      # 开启一个后台使命
  ${binName} mission list             # 列出当前所有使命
  ${binName} mission show <id>        # 查看特定使命详情
  ${binName} mission logs <id>        # 查看特定使命日志
  ${binName} mission attach <id>      # 以只读模式跟随使命输出直到结束
  ${binName} mission pause <id>       # 暂停待执行/运行中的使命
  ${binName} mission resume <id>      # 恢复已暂停的使命
  ${binName} mission cancel <id>      # 取消未完成的使命
  ${binName} mission stop <id>        # cancel 的直观别名
  ${binName} mission terminate <id>   # cancel 的安全控制面别名
  ${binName} mission retry <id>       # 从终态使命创建重试任务
  ${binName} mission respawn <id>     # retry 的直观别名
  ${binName} 使命 列表                # mission list 的中文别名
  ${binName} 使命 终止 <id>           # mission cancel 的中文别名
  ${binName} --help                   # 显示帮助

全局参数:
  --config <path>                     # 指定配置文件（json/yaml）
  --workspace <path>                  # 指定 workspace 根
  --no-workspace                      # 禁用 workspace 根
  --continue                          # 恢复最近一次 chat/repl 会话
  --resume <session>                  # 恢复指定 chat/repl 会话
  --file-cache-dir <path>             # 指定 file cache 根
  --file-state-dir <path>             # 指定 file state 根
  --inspect-prompt                    # 落盘 prompt 调试信息
  --inspect-request                   # 落盘 request 调试信息
  --log-format <text|json>            # 日志格式
  --log-level <debug|info|warn|error> # 日志级别

兼容别名:
  ${binName} --tui, --repl, --once "task", "task"
中文别名:
  ${binName} 帮助 | 诊断 | 状态 | 存储 | 导出列表 [count] | 会话列表 [count] | 检查点 [name] | 任务 | 目标 | 隐私 | 上下文 | 快捷键 | 状态线 | 回顾 | 权限 | 配置 | 外部工具 | 钩子 | 记忆 | 使命 | 代理 | 日志 <id>

本地边界:
  help / doctor / privacy / config 只读本地状态；不会调用模型或联网。
  API key 推荐配置到系统用户环境变量，例如 QLING_LLM_API_KEY；setup 不会写入 .env。

模式冲突示例:
  ${binName} repl --once "x"          # Error: [CLI_INVALID_MODE_COMBINATION]
`.trim();
}

interface ValueOptionResult {
  consumeNext: boolean;
  error?: {
    code: "CLI_INVALID_OPTION_VALUE";
    message: string;
  };
}
function parseResumeOption(
  args: string[],
  index: number,
  arg: string
): ValueOptionResult & { value?: string } {
  if (arg.startsWith("--resume=")) {
    const value = arg.slice("--resume=".length).trim();
    if (!value) {
      return invalidOption("--resume", value);
    }
    return { consumeNext: false, value };
  }
  const next = args[index + 1];
  if (!next) {
    return invalidOption("--resume", "");
  }
  return { consumeNext: true, value: next };
}

function parseValueOption(
  args: string[],
  index: number,
  arg: string,
  global: CliGlobalOptions
): ValueOptionResult | null {
  const setValue = (
    name: string,
    setter: (value: string) => void,
    validator?: (value: string) => boolean
  ): ValueOptionResult => {
    if (arg.startsWith(`${name}=`)) {
      const v = arg.slice(name.length + 1).trim();
      if (!v || (validator && !validator(v))) {
        return invalidOption(name, v);
      }
      setter(v);
      return { consumeNext: false };
    }
    if (arg === name) {
      const next = args[index + 1];
      if (!next || (validator && !validator(next))) {
        return invalidOption(name, next ?? "");
      }
      setter(next);
      return { consumeNext: true };
    }
    return { consumeNext: false };
  };

  if (arg === "--config" || arg.startsWith("--config=")) {
    return setValue("--config", (v) => (global.configPath = v));
  }
  if (arg === "--workspace" || arg.startsWith("--workspace=")) {
    return setValue("--workspace", (v) => (global.workspaceDir = v));
  }
  if (arg === "--file-cache-dir" || arg.startsWith("--file-cache-dir=")) {
    return setValue("--file-cache-dir", (v) => (global.fileCacheDir = v));
  }
  if (arg === "--file-state-dir" || arg.startsWith("--file-state-dir=")) {
    return setValue("--file-state-dir", (v) => (global.fileStateDir = v));
  }
  if (arg === "--log-format" || arg.startsWith("--log-format=")) {
    return setValue(
      "--log-format",
      (v) => (global.logFormat = v as CliGlobalOptions["logFormat"]),
      (v) => v === "text" || v === "json"
    );
  }
  if (arg === "--log-level" || arg.startsWith("--log-level=")) {
    return setValue(
      "--log-level",
      (v) => (global.logLevel = v as CliGlobalOptions["logLevel"]),
      (v) => v === "debug" || v === "info" || v === "warn" || v === "error"
    );
  }
  if (arg === "--model" || arg.startsWith("--model=")) {
    return setValue("--model", (v) => (global.model = v));
  }
  if (arg === "--provider" || arg.startsWith("--provider=")) {
    return setValue("--provider", (v) => (global.provider = v));
  }
  if (arg === "--endpoint" || arg.startsWith("--endpoint=")) {
    return setValue("--endpoint", (v) => (global.endpoint = v));
  }
  if (arg === "--api-key" || arg.startsWith("--api-key=")) {
    return setValue("--api-key", (v) => (global.apiKey = v));
  }
  return null;
}

function invalidOption(name: string, value: string): ValueOptionResult {
  return {
    consumeNext: false,
    error: {
      code: "CLI_INVALID_OPTION_VALUE",
      message: `invalid value for ${name}: ${value || "(empty)"}`,
    },
  };
}
