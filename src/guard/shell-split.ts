// ============================================================
// 轻灵 - Shell 命令轻量分段（无 tree-sitter 依赖）
// 用途：权限判定 / 危险模式匹配前的「分段 + 去包装 + 复杂语法标记」。
// 说明：这是安全向的近似解析，不是完整 POSIX shell 解析器；
//       遇到无法静态判定的语法一律标记 complex，由上层降级为人工确认。
// ============================================================

export interface ShellSplitResult {
  /** 各段分词结果（引号已剥离，控制运算符已切分） */
  segments: string[][];
  /** 含 $()、反引号、进程替换、heredoc、eval、shell -c 等动态语法时为 true */
  complex: boolean;
}

/** 会被 shell -c 语义包裹的解释器 */
const SHELL_NAMES = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash", "fish"]);

/** 命令包装器：去掉后才是真正的目标命令 */
const WRAPPER_COMMANDS = new Set([
  "sudo",
  "env",
  "timeout",
  "nice",
  "nohup",
  "command",
  "time",
  "xargs",
]);

/** 形如 VAR=value 的环境变量前缀赋值 */
const ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** 取最后一个路径分隔符后的命令名，去掉 Windows 扩展名并小写 */
export function commandBasename(word: string): string {
  const idx = Math.max(word.lastIndexOf("/"), word.lastIndexOf("\\"));
  const base = idx >= 0 ? word.slice(idx + 1) : word;
  return base.replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
}

function isOption(token: string): boolean {
  return token.length > 1 && token.startsWith("-");
}

/**
 * 分段 + 分词。
 * - 单/双引号内的 `&&`/`|` 等不切分（保持字面量）
 * - 反斜杠转义
 * - `&&`、`||`、`;`、`|`、`&`、换行 作为段分隔符
 */
export function splitShell(cmd: string): ShellSplitResult {
  const raw = typeof cmd === "string" ? cmd : String(cmd ?? "");
  const segments: string[][] = [];
  let current: string[] = [];
  let token = "";
  let hasToken = false;

  const flushToken = (): void => {
    if (hasToken) {
      current.push(token);
      token = "";
      hasToken = false;
    }
  };
  const flushSegment = (): void => {
    flushToken();
    if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  };

  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];

    // 反斜杠转义（含换行续行）
    if (ch === "\\") {
      if (i + 1 < raw.length) {
        if (raw[i + 1] === "\n") {
          i += 2;
          continue;
        }
        token += raw[i + 1];
        hasToken = true;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    // 单引号：内部全部字面量，无转义
    if (ch === "'") {
      const end = raw.indexOf("'", i + 1);
      const content = end === -1 ? raw.slice(i + 1) : raw.slice(i + 1, end);
      token += content;
      hasToken = true;
      i = end === -1 ? raw.length : end + 1;
      continue;
    }

    // 双引号：仅 \ " $ ` 换行 有转义语义
    if (ch === '"') {
      let j = i + 1;
      while (j < raw.length) {
        const c = raw[j];
        if (c === "\\") {
          const next = raw[j + 1];
          if (next === undefined) {
            j += 1;
            break;
          }
          if (next === '"' || next === "\\" || next === "$" || next === "`") {
            token += next;
            j += 2;
            continue;
          }
          if (next === "\n") {
            j += 2;
            continue;
          }
          token += "\\";
          j += 1;
          continue;
        }
        if (c === '"') {
          j += 1;
          break;
        }
        token += c;
        j += 1;
      }
      hasToken = true;
      i = j;
      continue;
    }

    if (ch === "\n" || ch === "\r") {
      flushSegment();
      i += 1;
      continue;
    }

    if (ch === "&") {
      if (raw[i + 1] === "&") {
        flushSegment();
        i += 2;
        continue;
      }
      // 重定向：2>&1、>&2 等
      if (token.endsWith(">") || token.endsWith("<")) {
        token += "&";
        hasToken = true;
        i += 1;
        continue;
      }
      flushSegment();
      i += 1;
      continue;
    }

    if (ch === "|") {
      if (raw[i + 1] === "|") {
        flushSegment();
        i += 2;
        continue;
      }
      flushSegment();
      i += 1;
      continue;
    }

    if (ch === ";") {
      flushSegment();
      i += 1;
      continue;
    }

    if (ch === " " || ch === "\t") {
      flushToken();
      i += 1;
      continue;
    }

    token += ch;
    hasToken = true;
    i += 1;
  }

  flushSegment();

  return { segments, complex: detectComplex(raw, segments) };
}

/** 复杂（无法静态判定）语法检测 */
function detectComplex(raw: string, segments: string[][]): boolean {
  if (
    raw.includes("$(") ||
    raw.includes("`") ||
    raw.includes("<(") ||
    /<<-?/.test(raw)
  ) {
    return true;
  }
  for (const seg of segments) {
    const words = unwrap(seg);
    const head = words[0] ? commandBasename(words[0]) : "";
    if (head === "eval") return true;
    if (
      SHELL_NAMES.has(head) &&
      words.slice(1).some((w) => /^-[A-Za-z]*c/i.test(w) || w === "--command")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 去掉命令包装器（sudo/env/timeout/nice/nohup/command/time/xargs）
 * 与前置 `VAR=value` 赋值，返回真正的目标命令词序列。
 */
export function unwrap(words: string[]): string[] {
  const remaining = Array.isArray(words) ? words.slice() : [];
  let guard = 0;
  while (remaining.length > 0 && guard < 64) {
    guard += 1;
    const head = remaining[0];
    if (ASSIGN_RE.test(head)) {
      remaining.shift();
      continue;
    }
    const base = commandBasename(head);
    if (!WRAPPER_COMMANDS.has(base)) break;
    remaining.shift();
    stripWrapperArgs(base, remaining);
  }
  return remaining;
}

/** 跳过包装器自身的选项/参数（保守：只处理常见形式） */
function stripWrapperArgs(wrapper: string, remaining: string[]): void {
  if (wrapper === "timeout") {
    while (remaining.length > 0 && isOption(remaining[0])) remaining.shift();
    if (remaining.length > 0 && /^\d+(?:\.\d+)?[smhd]?$/.test(remaining[0])) {
      remaining.shift();
    }
    return;
  }

  if (wrapper === "env") {
    while (remaining.length > 0) {
      const token = remaining[0];
      if (isOption(token)) {
        remaining.shift();
        if (token === "-u" || token === "--unset" || token === "-U") remaining.shift();
        continue;
      }
      if (ASSIGN_RE.test(token)) {
        remaining.shift();
        continue;
      }
      break;
    }
    return;
  }

  if (wrapper === "xargs") {
    const argFlags = new Set([
      "-I",
      "-n",
      "-P",
      "-s",
      "-L",
      "-d",
      "-E",
      "-a",
      "-o",
      "--max-args",
      "--max-procs",
      "--delimiter",
      "--arg-file",
      "--max-lines",
    ]);
    while (remaining.length > 0 && isOption(remaining[0])) {
      const token = remaining.shift() as string;
      if (argFlags.has(token)) remaining.shift();
    }
    return;
  }

  if (wrapper === "nice") {
    while (remaining.length > 0 && isOption(remaining[0])) {
      const token = remaining.shift() as string;
      if (token === "-n" || token === "--adjustment") remaining.shift();
    }
    return;
  }

  if (wrapper === "sudo") {
    const argFlags = new Set([
      "-u",
      "-g",
      "-p",
      "-C",
      "-h",
      "-r",
      "-t",
      "-U",
      "--user",
      "--group",
      "--prompt",
      "--chdir",
      "--host",
      "--role",
      "--type",
      "--other-user",
    ]);
    while (remaining.length > 0 && isOption(remaining[0])) {
      const token = remaining.shift() as string;
      if (argFlags.has(token)) remaining.shift();
    }
    return;
  }

  // command / nohup / time：仅跳过选项
  while (remaining.length > 0 && isOption(remaining[0])) remaining.shift();
}

/**
 * 便捷函数：返回每个 segment 去包装后以空格拼接的字符串。
 * 供危险模式匹配与参数级 allow 规则使用。
 */
export function commandSubjects(cmd: string): string[] {
  const { segments } = splitShell(cmd);
  return segments.map((seg) => unwrap(seg).join(" "));
}
