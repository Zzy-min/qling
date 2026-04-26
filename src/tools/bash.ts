// ============================================================
// 轻灵 - bash 工具 v3
// - exec → spawn（非阻塞父进程）
// - 超时自动 kill
// - stdout/stderr 正确路由（避免 NotADirectoryError）
// ============================================================

import { spawn } from "child_process";
import { ToolDefinition, ToolResult } from "../types.js";

export const bashTool: ToolDefinition = {
  name: "bash",
  description:
    "Execute shell commands on Linux/Windows (git, npm, file operations, CLI tools). Returns stdout/stderr. Hook intercepts dangerous operations (rm -rf, disk format, etc.).",
  longDescription: `执行 shell 命令的万能工具。**Linux**: 通过 /bin/sh 执行。**Windows**: 通过 cmd.exe 执行（而非 PowerShell）。
**重要 - Windows 用户**：Windows 上请使用标准的 cmd.exe 命令（dir, type, copy, del 等），不要使用 PowerShell 独有语法（Invoke-WebRequest 等）。cmd.exe 不支持 PowerShell cmdlet。
**Linux 用户**：通过 /bin/sh 执行标准 POSIX 命令。

**使用场景**:
- git 操作（git add, git commit, git push）
- npm/node 命令（npm install, node scripts）
- 文件操作（ls, cp, mv, mkdir）
- 进程管理（ps, kill, pgrep）
- 网络工具（curl, wget, ping）
- 编译构建（make, gcc, cargo）

**注意事项**:
- rm -rf 等危险操作会被 Hook 拦截并要求确认
- Windows 下需要通过 cmd.exe /c 执行
- 长时间运行的命令建议设置 timeout`,
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
}): Promise<ToolResult> {
  return new Promise((resolve) => {
    const timeout = (args.timeout ?? 60) * 1000;
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const shellArgs = process.platform === "win32" ? ["/c", args.command] : ["-c", args.command];

    const proc = spawn(shell, shellArgs, {
      cwd: args.cwd ?? process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (code: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;

      // 超时
      if (code === null && signal === "SIGTERM") {
        resolve({
          tool_call_id: "",
          output: `exit code: null (killed after ${args.timeout ?? 60}s timeout)\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          is_error: true,
        });
        return;
      }

      // 组合输出（避免 stderr 干扰主输出）
      if (stderr.trim()) {
        resolve({
          tool_call_id: "",
          output: `stdout:\n${stdout}\nstderr:\n${stderr}`,
          is_error: code !== 0,
        });
      } else {
        resolve({
          tool_call_id: "",
          output: stdout || "(no output)",
          is_error: code !== 0,
        });
      }
    };

    // 超时控制
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      // 给进程一点时间优雅退出
      setTimeout(() => {
        if (!settled) proc.kill("SIGKILL");
      }, 2000);
    }, timeout);

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      finish(code, signal);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({
          tool_call_id: "",
          output: `spawn error: ${err.message}`,
          is_error: true,
        });
      }
    });
  });
}
