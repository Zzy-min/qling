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
import { getRuntimeRootsFromEnv, isWithinAllowedRoots, resolveToolPath } from "../runtime-paths.js";

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
        description: "Timeout in seconds (default: 60, max: 300)",
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
      description: "命令超时秒数。默认 60 秒，最大 300 秒。超时后进程会被 SIGTERM 强制终止。",
      minimum: 1,
      maximum: 300,
      default: 60,
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

  const timeoutSec = Math.max(1, Math.min(300, args.timeout ?? 60));
  const roots = getRuntimeRootsFromEnv();
  const cwdInput = String(args.cwd ?? ".").trim();
  const cwd = resolveToolPath(cwdInput, roots, "workspace");
  if (!isWithinAllowedRoots(cwd, roots)) {
    return toolError("BASH_OUTSIDE_ALLOWED_ROOT", `${cwd} is outside allowed roots`);
  }
  try {
    const cwdStat = await stat(cwd);
    if (!cwdStat.isDirectory()) {
      return toolError("BASH_INVALID_CWD", `${cwd} is not a directory`);
    }
  } catch {
    return toolError("BASH_CWD_NOT_FOUND", `cwd not found: ${cwd}`);
  }

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
