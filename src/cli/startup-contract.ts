import type { CliGlobalOptions } from "../config.js";

export type CliMode = "help" | "run" | "chat" | "repl" | "workflow" | "memory" | "dashboard" | "discovery" | "setup";

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
  code: "CLI_INVALID_MODE_COMBINATION" | "CLI_MISSING_TASK" | "CLI_INVALID_OPTION_VALUE";
  message: string;
  exitCode: 2;
}

export type CliResolution = CliResolutionOk | CliResolutionErr;

export function formatCliError(code: string, message: string): string {
  return `Error: [${code}] ${message}`;
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

    if (arg === "--help" || arg === "-h") {
      hasHelp = true;
      continue;
    }

    if (!arg.startsWith("-") && modeFromSubcommand === null && positional.length === 0) {
      const knownModes = ["run", "chat", "repl", "workflow", "memory", "dashboard", "discovery", "setup"];
      if (knownModes.includes(arg)) {
        modeFromSubcommand = arg as CliMode;
        if (["workflow", "memory", "dashboard", "discovery", "setup"].includes(arg)) {
          subArgs.push(...args.slice(i + 1));
          break;
        }
        continue;
      }
    }

    if (arg === "--tui" || arg === "-t") {
      modeFromAliasChat = true;
      warnings.push("`--tui` is deprecated, use `qingling chat` instead.");
      continue;
    }
    if (arg === "--repl" || arg === "-r") {
      modeFromAliasRepl = true;
      warnings.push("`--repl` is deprecated, use `qingling repl` instead.");
      continue;
    }
    if (arg === "--once") {
      const next = args[i + 1];
      if (!next) {
        return {
          kind: "error",
          code: "CLI_MISSING_TASK",
          message: "`--once` requires a task string, e.g. --once \"修复 bug\"",
          exitCode: 2,
        };
      }
      onceTask = next;
      warnings.push("`--once` is deprecated, use `qingling run \"task\"` instead.");
      i++;
      continue;
    }
    if (arg.startsWith("--once=")) {
      const value = arg.slice("--once=".length).trim();
      if (!value) {
        return {
          kind: "error",
          code: "CLI_MISSING_TASK",
          message: "`--once` requires a task string, e.g. --once \"修复 bug\"",
          exitCode: 2,
        };
      }
      onceTask = value;
      warnings.push("`--once` is deprecated, use `qingling run \"task\"` instead.");
      continue;
    }

    if (arg === "--no-workspace") {
      global.noWorkspace = true;
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
    return { kind: "ok", mode: "help", subArgs: [], global, warnings };
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
    const task = onceTask ?? positional.join(" ").trim();
    if (!task) {
      return {
        kind: "error",
        code: "CLI_MISSING_TASK",
        message: "`run` requires a task string, e.g. qingling run \"修复 bug\"",
        exitCode: 2,
      };
    }
    return { kind: "ok", mode: "run", task, subArgs: [], global, warnings };
  }

  if (["workflow", "memory", "dashboard", "discovery", "setup"].includes(modeFromSubcommand || "")) {
    return { kind: "ok", mode: modeFromSubcommand!, subArgs, global, warnings };
  }

  if (modeFromSubcommand === "chat") {
    if (hasPositional) {
      return {
        kind: "error",
        code: "CLI_INVALID_MODE_COMBINATION",
        message: "`chat` mode does not accept a one-shot task. Use `qingling run \"task\"`.",
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
        message: "`repl` mode does not accept a one-shot task. Use `qingling run \"task\"`.",
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
        message: "`--tui` mode does not accept a one-shot task. Use `qingling run \"task\"`.",
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
        message: "`--repl` mode does not accept a one-shot task. Use `qingling run \"task\"`.",
        exitCode: 2,
      };
    }
    return { kind: "ok", mode: "repl", subArgs: [], global, warnings };
  }

  if (hasOnce) {
    return { kind: "ok", mode: "run", task: onceTask!, subArgs: [], global, warnings };
  }

  if (hasPositional) {
    warnings.push("positional one-shot form is deprecated, prefer `qingling run \"task\"`.");
    return { kind: "ok", mode: "run", task: positional.join(" "), subArgs: [], global, warnings };
  }

  return { kind: "ok", mode: "chat", subArgs: [], global, warnings };
}

export function buildHelpText(binName = "qingling"): string {
  return `
${binName} - 通用 CLI Agent

主要用法:
  ${binName}                          # 默认进入流式 TUI（chat）
  ${binName} chat                     # 显式进入流式 TUI
  ${binName} repl                     # 简易 REPL
  ${binName} run "你的任务"            # 单次执行（推荐）
  ${binName} setup                    # [新] 交互式配置 LLM 提供商 (v0.3)

管理命令 (v0.3):
  ${binName} workflow resume <id>     # 从状态机 Checkpoint 恢复执行
  ${binName} memory reindex [--full]  # 重新构建语义记忆向量索引
  ${binName} dashboard start [--port] # 启动本地白盒化观测控制台
  ${binName} discovery sync           # 同步动态插件与技能
  ${binName} --help                   # 显示帮助

全局参数:
  --config <path>                     # 指定配置文件（json/yaml）
  --workspace <path>                  # 指定 workspace 根
  --no-workspace                      # 禁用 workspace 根
  --file-cache-dir <path>             # 指定 file cache 根
  --file-state-dir <path>             # 指定 file state 根
  --inspect-prompt                    # 落盘 prompt 调试信息
  --inspect-request                   # 落盘 request 调试信息
  --log-format <text|json>            # 日志格式
  --log-level <debug|info|warn|error> # 日志级别

兼容别名:
  ${binName} --tui, --repl, --once "task", "task"
`.trim();
}

interface ValueOptionResult {
  consumeNext: boolean;
  error?: {
    code: "CLI_INVALID_OPTION_VALUE";
    message: string;
  };
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
