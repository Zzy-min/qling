// ============================================================
// 轻灵 - bash 工具 v3
// - exec → spawn（非阻塞父进程）
// - 超时自动 kill
// - stdout/stderr 正确路由（避免 NotADirectoryError）
// ============================================================

import { spawn, execFileSync } from "child_process";
import { stat } from "fs/promises";
import { ToolDefinition, ToolResult } from "../types.js";
import { toolError, toolSuccess } from "./error-utils.js";
import { getRuntimeRootsFromEnv, resolveToolPath } from "../runtime-paths.js";

const MAX_COMMAND_LENGTH = 5000;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB per stream

export const bashTool: ToolDefinition = {
  name: "bash",
  description:
    "Execute shell commands (git, npm, opencli, file ops). For Douyin/Xiaohongshu/Weibo/etc. run opencli after skill name=opencli; prefer opencli … -f json. Not for raw fetch of anti-bot pages.",
  longDescription: `执行 shell 命令的万能工具。**Linux**: 通过 /bin/sh 执行。**Windows**: 通过 cmd.exe 执行（而非 PowerShell）。
**重要 - Windows 用户**：Windows 上请使用标准的 cmd.exe 命令（dir, type, copy, del 等），不要使用 PowerShell 独有语法（Invoke-WebRequest 等）。cmd.exe 不支持 PowerShell cmdlet。
**Linux 用户**：通过 /bin/sh 执行标准 POSIX 命令。

**使用场景**:
- git 操作（git add, git commit, git push）
- npm/node 命令（npm install, node scripts）
- **opencli**（本机已安装时）：opencli list / opencli douyin search … -f json（先 skill name="opencli"）
- 文件操作（ls, cp, mv, mkdir）
- 进程管理（ps, kill, pgrep）
- 网络工具（curl, wget, ping）— 强反爬社交站不要用 curl 硬抓
- 编译构建（make, gcc, cargo）

**注意事项**:
- rm -rf 等危险操作会被 Hook 拦截并要求确认
- Windows 下需要通过 cmd.exe /c 执行
- 长时间运行的命令建议设置 timeout
- opencli 写操作（delete/publish）须用户确认`,
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Shell command to execute",
      },
      cwd: {
        type: "string",
        description: "Working directory (optional, defaults to current)",
      },
      timeout: {
        type: "number",
        description:
          "Timeout in seconds. Foreground default 60 max 300. Background: max lifetime seconds (default 1800; 0 = no auto-kill).",
      },
      background: {
        type: "boolean",
        description:
          "If true, run in background and return task_id immediately (use bg_wait/bg_kill or /tasks wait|kill).",
      },
      env_allowlist: {
        type: "array",
        description: "Extra environment keys to inherit from host process",
      },
      env_inject: {
        type: "object",
        description: "Explicit env key/value overrides (guarded by key format check)",
      },
    },
    required: ["command"],
  },
  paramSchema: {
    command: {
      type: "string",
      description: "要执行的完整 shell 命令",
      minLength: 1,
      maxLength: 5000,
    },
    cwd: {
      type: "string",
      description: "工作目录路径（可选）。Linux 格式: /home/user/project，Windows 格式: C:\\Users\\...",
    },
    timeout: {
      type: "number",
      description:
        "超时秒数。前台默认 60、最大 300。后台=最长存活秒（默认 1800，0=不自动 kill）。",
      minimum: 0,
      maximum: 86400,
      default: 60,
    },
    background: {
      type: "boolean",
      description: "true 时后台执行并立即返回 task_id",
      default: false,
    },
    env_allowlist: {
      type: "array",
      description: "额外继承的环境变量名数组，例如 [\"HTTP_PROXY\"]",
      items: { type: "string", description: "环境变量名" },
    },
    env_inject: {
      type: "object",
      description: "显式注入的环境变量键值对（键必须匹配 ^[A-Z_][A-Z0-9_]*$）",
    },
  },
  examples: [
    "git status",
    "npm install express",
    "curl -X GET https://api.example.com/data",
    "ls -la /tmp",
  ],
  seeAlso: ["read", "write"],
  scenes: ["coding", "system"],
  priority: 8,
  readOnly: false,
  destructive: false,
  concurrencySafe: false,
  dangerousPatterns: [
    "rm -rf /",
    "rm -rf /*",
    ":(){ :|:& };:",  // fork bomb
    "mkfs",
    "dd if=/dev/zero",
    "> /etc/passwd",
  ],
  effortHint: "medium",
};

export async function runBash(args: {
  command: string;
  cwd?: string;
  timeout?: number;
  background?: boolean;
  env_allowlist?: string[];
  env_inject?: Record<string, string>;
}): Promise<ToolResult> {
  const command = String(args.command ?? "").trim();
  if (!command) {
    return toolError("BASH_EMPTY_COMMAND", "command is required");
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    return toolError(
      "BASH_COMMAND_TOO_LONG",
      `command exceeds ${MAX_COMMAND_LENGTH} characters (current: ${command.length})`
    );
  }

  const background = Boolean(args.background);
  const roots = getRuntimeRootsFromEnv();
  const cwdInput = String(args.cwd ?? ".").trim();
  const cwd = resolveToolPath(cwdInput, roots, "workspace");
  const { isBashCwdAllowed, resolveSandboxProfile } = await import(
    "../runtime/sandbox-profile.js"
  );
  const profile = resolveSandboxProfile();
  if (!isBashCwdAllowed(cwd, profile, roots)) {
    return toolError(
      "BASH_OUTSIDE_ALLOWED_ROOT",
      `${cwd} is outside sandbox profile "${profile}" for bash cwd`
    );
  }
  try {
    const cwdStat = await stat(cwd);
    if (!cwdStat.isDirectory()) {
      return toolError("BASH_INVALID_CWD", `${cwd} is not a directory`);
    }
  } catch {
    return toolError("BASH_CWD_NOT_FOUND", `cwd not found: ${cwd}`);
  }

  if (background) {
    try {
      const { getBackgroundTaskRegistry } = await import("../runtime/background-tasks.js");
      const reg = getBackgroundTaskRegistry();
      const rawTimeout = args.timeout;
      const timeoutSec =
        typeof rawTimeout === "number" && Number.isFinite(rawTimeout)
          ? Math.max(0, Math.min(86400, Math.floor(rawTimeout)))
          : 1800;
      const task = reg.startShell({
        command,
        cwd,
        env: buildSafeEnv(args.env_allowlist ?? [], args.env_inject ?? {}),
        timeoutSec,
      });
      return toolSuccess(
        [
          "background: started",
          `task_id: ${task.taskId}`,
          `status: ${task.status}`,
          `pid: ${task.pid ?? "-"}`,
          `cwd: ${task.cwd}`,
          `command: ${task.command}`,
          `max_lifetime_sec: ${timeoutSec === 0 ? "none" : timeoutSec}`,
          "use bg_wait / bg_kill or /tasks wait|kill with this task_id",
        ].join("\n")
      );
    } catch (err) {
      return toolError(
        "BASH_BACKGROUND_START_FAILED",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  const timeoutSec = Math.max(1, Math.min(300, args.timeout ?? 60));

  return new Promise((resolve) => {
    const timeout = timeoutSec * 1000;
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];

    const proc = spawn(shell, shellArgs, {
      cwd,
      env: buildSafeEnv(args.env_allowlist ?? [], args.env_inject ?? {}),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let timedOut = false;

    const appendCapped = (
      current: string,
      incoming: Buffer,
      currentBytes: number
    ): { next: string; bytes: number; truncated: boolean } => {
      if (currentBytes >= MAX_OUTPUT_BYTES) {
        return { next: current, bytes: currentBytes, truncated: true };
      }
      const remaining = MAX_OUTPUT_BYTES - currentBytes;
      if (incoming.byteLength <= remaining) {
        return {
          next: current + incoming.toString(),
          bytes: currentBytes + incoming.byteLength,
          truncated: false,
        };
      }
      return {
        next: current + incoming.subarray(0, remaining).toString(),
        bytes: MAX_OUTPUT_BYTES,
        truncated: true,
      };
    };

    const finish = (code: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;

      const stdoutSuffix = stdoutTruncated ? `\n[stdout truncated at ${MAX_OUTPUT_BYTES} bytes]` : "";
      const stderrSuffix = stderrTruncated ? `\n[stderr truncated at ${MAX_OUTPUT_BYTES} bytes]` : "";

      // 超时
      if (timedOut) {
        resolve(
          toolError(
            "BASH_TIMEOUT",
            `killed after ${timeoutSec}s timeout\nstdout:\n${stdout}${stdoutSuffix}\nstderr:\n${stderr}${stderrSuffix}`
          )
        );
        return;
      }

      // 组合输出（避免 stderr 干扰主输出）
      const combined =
        stderr.trim().length > 0
          ? `stdout:\n${stdout}${stdoutSuffix}\nstderr:\n${stderr}${stderrSuffix}`
          : `${stdout || "(no output)"}${stdoutSuffix}`;

      if ((code ?? 0) !== 0) {
        resolve(toolError("BASH_EXIT_NON_ZERO", `exit code: ${code ?? "null"}\n${combined}`));
        return;
      }

      if (stderr.trim()) {
        resolve(toolSuccess(combined));
      } else {
        resolve(toolSuccess(combined));
      }
    };

    // 超时控制
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32") {
        // Windows: 用 taskkill 强制终止进程树
        try {
          execFileSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { timeout: 5000 });
        } catch {
          proc.kill();
        }
      } else {
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!settled) proc.kill("SIGKILL");
        }, 2000);
      }
    }, timeout);

    proc.stdout?.on("data", (chunk: Buffer) => {
      const next = appendCapped(stdout, chunk, stdoutBytes);
      stdout = next.next;
      stdoutBytes = next.bytes;
      stdoutTruncated ||= next.truncated;
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const next = appendCapped(stderr, chunk, stderrBytes);
      stderr = next.next;
      stderrBytes = next.bytes;
      stderrTruncated ||= next.truncated;
    });

    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      finish(code, signal);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve(toolError("BASH_SPAWN_ERROR", `spawn error: ${err.message}`));
      }
    });
  });
}

function buildSafeEnv(envAllowlist: string[], envInject: Record<string, string>): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  const baseKeys = new Set([
    "PATH",
    "HOME",
    "USERPROFILE",
    "TMP",
    "TEMP",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TERM",
    "LANG",
    "LC_ALL",
  ]);

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("QLING_") || baseKeys.has(key.toUpperCase())) {
      safe[key] = value;
    }
  }

  for (const key of envAllowlist) {
    const normalized = key.trim();
    if (!isSafeEnvKey(normalized)) continue;
    if (process.env[normalized] !== undefined) {
      safe[normalized] = process.env[normalized];
    }
  }

  for (const [key, value] of Object.entries(envInject)) {
    const normalized = key.trim();
    if (!isSafeEnvKey(normalized)) continue;
    safe[normalized] = String(value);
  }

  return safe;
}

function isSafeEnvKey(key: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(key);
}
