// ============================================================
// 轻灵 - search 工具
// 文件内容搜索（grep）和文件名搜索（glob/find）
// ============================================================

import { execSync } from "child_process";
import { stat } from "fs/promises";
import { resolve } from "path";
import { ToolDefinition, ToolResult } from "../types.js";

export const searchTool: ToolDefinition = {
  name: "search",
  description:
    "Search file contents (grep) or find files by name (glob). Returns matching lines with file paths and line numbers, or file paths only.",
  longDescription: `搜索文件内容或按名称查找文件。**不会修改任何文件**。

**两种模式**:

1. **内容搜索**（target="content"，默认）:
   - 用正则表达式在文件中搜索
   - 返回匹配的行号和内容
   - 支持文件类型过滤（file_glob）
   - 支持上下文行（context）

2. **文件搜索**（target="files"）:
   - 用 glob 模式查找文件名
   - 返回匹配的文件路径列表

**使用场景**:
- 在项目中搜索某个函数/变量的使用位置
- 查找所有 TypeScript 文件
- 搜索错误信息的出处
- 查找配置文件位置`,
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Regex pattern for content search, or glob pattern for file search",
      },
      path: {
        type: "string",
        description: "Directory or file to search in (default: current directory)",
      },
      target: {
        type: "string",
        enum: ["content", "files"],
        description: "Search target: 'content' for grep, 'files' for file name search",
      },
      file_glob: {
        type: "string",
        description: "Filter files by glob pattern (e.g. '*.ts', '*.json')",
      },
      context: {
        type: "number",
        description: "Context lines around matches (default: 0)",
      },
      limit: {
        type: "number",
        description: "Max results to return (default: 50)",
      },
    },
    required: ["pattern"],
  },
  paramSchema: {
    pattern: {
      type: "string",
      description: "搜索模式。内容搜索用正则表达式，文件搜索用 glob 模式。",
      minLength: 1,
    },
    path: {
      type: "string",
      description: "搜索路径。默认当前目录。",
    },
    target: {
      type: "string",
      description: "搜索目标：content=内容搜索（grep），files=文件名搜索（find）",
      enum: ["content", "files"],
      default: "content",
    },
    file_glob: {
      type: "string",
      description: "文件类型过滤，如 *.ts, *.json",
    },
    context: {
      type: "number",
      description: "匹配行的上下文行数。默认 0。",
      minimum: 0,
      maximum: 10,
      default: 0,
    },
    limit: {
      type: "number",
      description: "最大返回结果数。默认 50。",
      minimum: 1,
      maximum: 200,
      default: 50,
    },
  },
  examples: [
    'search pattern="TODO" file_glob="*.ts"',
    'search pattern="export.*function" path="src/"',
    'search pattern="*.json" target="files"',
    'search pattern="error" context=2 limit=20',
  ],
  seeAlso: ["read", "bash"],
  scenes: ["coding", "data"],
  priority: 8,
  readOnly: true,
  destructive: false,
  concurrencySafe: true,
  effortHint: "low",
};

export async function runSearch(args: {
  pattern: string;
  path?: string;
  target?: string;
  file_glob?: string;
  context?: number;
  limit?: number;
}): Promise<ToolResult> {
  const searchPath = args.path ?? process.cwd();
  const target = args.target ?? "content";
  const limit = args.limit ?? 50;

  try {
    // Verify path exists
    await stat(searchPath);
  } catch {
    return { tool_call_id: "", output: `Error: path not found: ${searchPath}`, is_error: true };
  }

  try {
    if (target === "files") {
      // File name search using find
      const resolvedPath = resolve(searchPath);
      let cmd: string;
      const isWin = process.platform === "win32";

      if (isWin) {
        // Windows: use dir /s /b with findstr
        const nameFilter = args.pattern.replace(/\*/g, "%").replace(/\?/g, "_");
        cmd = `dir /s /b "${resolvedPath}" | findstr /i "${nameFilter}"`;
      } else {
        cmd = `find "${resolvedPath}" -type f -name "${args.pattern}" 2>/dev/null | head -${limit}`;
      }

      const stdout = execSync(cmd, {
        encoding: "utf-8",
        timeout: 15_000,
        cwd: searchPath,
      });

      const files = stdout.trim().split("\n").filter(Boolean);
      if (files.length === 0) {
        return { tool_call_id: "", output: "No files found matching pattern." };
      }

      const result = files.slice(0, limit).join("\n");
      const suffix = files.length > limit ? `\n... and ${files.length - limit} more` : "";
      return { tool_call_id: "", output: `Found ${files.length} file(s):\n${result}${suffix}` };
    }

    // Content search using grep
    const isWin = process.platform === "win32";
    const absPath = resolve(searchPath);
    let cmd: string;

    if (isWin) {
      // Windows: use findstr
      const ctx = args.context && args.context > 0 ? ` /C:${args.context}` : "";
      cmd = `findstr /S /N /I${ctx} "${args.pattern}" "${absPath}\\*"`;
      if (args.file_glob) {
        const ext = args.file_glob.replace(/^\*\./, ".");
        cmd = `findstr /S /N /I${ctx} /M "${args.pattern}" "${absPath}\\*${ext}"`;
        cmd = `findstr /S /N /I${ctx} "${args.pattern}" "${absPath}\\*${ext}"`;
      }
    } else {
      const ctx = args.context && args.context > 0 ? ` -C ${args.context}` : "";
      const globFilter = args.file_glob ? ` --include="${args.file_glob}"` : "";
      cmd = `grep -rn --color=never${ctx}${globFilter} "${args.pattern}" "${absPath}" 2>/dev/null | head -${limit}`;
    }

    const stdout = execSync(cmd, {
      encoding: "utf-8",
      timeout: 15_000,
      cwd: searchPath,
      maxBuffer: 1024 * 1024, // 1MB
    });

    const matches = stdout.trim().split("\n").filter(Boolean);
    if (matches.length === 0) {
      return { tool_call_id: "", output: "No matches found." };
    }

    const suffix = matches.length >= limit ? `\n... (truncated at ${limit} results)` : "";
    return {
      tool_call_id: "",
      output: `${matches.length} match(es):\n${matches.slice(0, limit).join("\n")}${suffix}`,
    };
  } catch (err: unknown) {
    const msg = (err as Error).message;
    if (msg.includes("no match") || msg.includes("not found") || (err as any).status === 1) {
      return { tool_call_id: "", output: "No matches found." };
    }
    return { tool_call_id: "", output: `Error: ${msg}`, is_error: true };
  }
}
