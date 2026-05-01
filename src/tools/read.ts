// ============================================================
// 轻灵 - read 工具
// ============================================================

import { readFile } from "fs/promises";
import { stat } from "fs/promises";
import { ToolDefinition, ToolResult } from "../types.js";
import { getErrorMessage, toolError, toolSuccess } from "./error-utils.js";
import { getRuntimeRootsFromEnv, isWithinAllowedRoots, resolveToolPath } from "../runtime-paths.js";

const MAX_READ_LINES = 2000;
const DEFAULT_READ_LINES = 500;
const MAX_READ_BYTES = 2 * 1024 * 1024; // 2MB

export const readTool: ToolDefinition = {
  name: "read",
  description:
    "Read the contents of a local file (code, config, logs, text files). Binary files return an error. Supports line offset/limit for partial reads.",
  longDescription: `读取本地文件内容。**不会修改任何文件**。

**使用场景**:
- 查看源代码文件（.ts, .js, .py, .java）
- 查看配置文件（.json, .yaml, .env, .toml）
- 查看日志文件（.log, .txt）
- 查看 Markdown 文档

**行为**:
- 文件不存在或路径无效 → 返回错误
- 二进制文件 → 返回错误
- 大文件（>500 行）→ 自动分页（可用 offset/limit 控制范围）
- 返回内容包含行号，便于定位

**使用建议**:
- 先用 bash ls 查看目录结构，再用 read 读取具体文件
- 配合 offset/limit 读取大文件的特定部分`,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative path to the file" },
      offset: { type: "number", description: "Line number to start reading from (1-indexed, default: 1)" },
      limit: { type: "number", description: "Maximum number of lines to read (default: 500, max: 2000)" },
    },
    required: ["path"],
  },
  paramSchema: {
    path: {
      type: "string",
      description: "文件路径。支持绝对路径和相对路径。相对路径以当前工作目录为基准。",
      minLength: 1,
    },
    offset: {
      type: "number",
      description: "起始行号（1-indexed）。例如 offset=100 表示从第 100 行开始读。省略则从第 1 行开始。",
      minimum: 1,
      default: 1,
    },
    limit: {
      type: "number",
      description: "最多读取的行数。超过此数量的文件会被截断并提示总行数。最大 2000 行。",
      minimum: 1,
      maximum: 2000,
      default: 500,
    },
  },
  examples: [
    "read src/app.ts",
    "read package.json",
    "read server.log offset=100 limit=50",
    "read /etc/config.yaml",
  ],
  seeAlso: ["write", "bash"],
  scenes: ["coding", "data"],
  priority: 9, // 高优先级（读取是高频操作）
  readOnly: true,
  destructive: false,
  concurrencySafe: true,
  effortHint: "minimal",
};

export async function runRead(args: {
  path: string;
  offset?: number;
  limit?: number;
}): Promise<ToolResult> {
  const filePath = String(args.path ?? "").trim();
  if (!filePath) {
    return toolError("READ_INVALID_PATH", "path is required");
  }
  const roots = getRuntimeRootsFromEnv();
  const resolvedPath = resolveToolPath(filePath, roots, "workspace");
  if (!isWithinAllowedRoots(resolvedPath, roots)) {
    return toolError("READ_OUTSIDE_ALLOWED_ROOT", `${resolvedPath} is outside allowed roots`);
  }

  const offset = Math.max(0, (args.offset ?? 1) - 1);
  const limit = Math.min(MAX_READ_LINES, Math.max(1, args.limit ?? DEFAULT_READ_LINES));

  try {
    const stats = await stat(resolvedPath);
    if (!stats.isFile()) {
      return toolError("READ_NOT_FILE", `${resolvedPath} is not a file`);
    }
    if (stats.size > MAX_READ_BYTES) {
      return toolError(
        "READ_FILE_TOO_LARGE",
        `${resolvedPath} exceeds ${MAX_READ_BYTES} bytes (current: ${stats.size})`
      );
    }

    const content = await readFile(resolvedPath, "utf-8");
    if (content.includes("\u0000")) {
      return toolError("READ_BINARY_FILE", `${resolvedPath} appears to be binary`);
    }

    const lines = content.split("\n");
    const selected = lines.slice(offset, offset + limit);
    const header =
      lines.length > limit
        ? `[显示第 ${offset + 1}-${offset + selected.length} 行，共 ${lines.length} 行]\n`
        : "";

    return toolSuccess(header + selected.join("\n"));
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return toolError("READ_PATH_NOT_FOUND", `${resolvedPath} not found`);
    if (code === "EACCES" || code === "EPERM") {
      return toolError("READ_PERMISSION_DENIED", `permission denied for ${resolvedPath}`);
    }
    return toolError("READ_FAILED", getErrorMessage(err));
  }
}
