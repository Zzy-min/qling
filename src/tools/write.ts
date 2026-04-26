import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { ToolDefinition, ToolResult } from "../types.js";

export const writeTool: ToolDefinition = {
  name: "write",
  description:
    "Create or overwrite a file with given content. Parent directories are created automatically. Use for code, config, markdown, scripts, or any text files.",
  longDescription: `创建或覆盖文件。**会修改磁盘文件**。

**使用场景**:
- 写入源代码文件（.ts, .js, .py, .java）
- 写入配置文件（.json, .yaml, .env）
- 写入 Markdown 文档（README.md, DESIGN.md）
- 写入脚本文件（.sh, .ps1）

**行为**:
- 父目录不存在时自动创建（recursive: true）
- 文件已存在时**覆盖**（无确认，无备份）
- 返回成功消息（含写入路径）

**危险警告**:
- 覆盖系统文件（如 /etc/hosts）可能造成严重后果
- 建议先 read 检查现有内容
- Hook 会拦截可疑的目标路径

**写入大文件**:
- 单次写入建议不超过 50KB
- 超大文件建议分多次写入`,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file (directories created automatically)",
      },
      content: {
        type: "string",
        description: "The complete content to write to the file",
      },
    },
    required: ["path", "content"],
  },
  paramSchema: {
    path: {
      type: "string",
      description: "目标文件路径。父目录不存在时会自动创建。相对路径以当前工作目录为基准。",
      minLength: 1,
    },
    content: {
      type: "string",
      description: "要写入的完整文件内容。建议不超过 50KB。超大型文件建议分多次写入。",
    },
  },
  examples: [
    'write path="src/utils.ts" content="export const foo = 1;"',
    'write path="config.json" content=\'{"version": "1.0"}\'',
    'write path="scripts/deploy.sh" content="#!/bin/bash\\necho done"',
  ],
  seeAlso: ["read", "bash"],
  scenes: ["coding", "data"],
  priority: 9, // 写入也是高频
  readOnly: false,
  destructive: false, // write 覆盖文件不等于破坏性（是预期行为）
  concurrencySafe: false,
  dangerousPatterns: [
    "/etc/passwd",
    "/etc/shadow",
    "/etc/sudoers",
    "C:\\Windows\\System32",
    "/sys/",
    "/proc/",
  ],
  effortHint: "medium",
};

export async function runWrite(args: {
  path: string;
  content: string;
}): Promise<ToolResult> {
  try {
    await mkdir(dirname(args.path), { recursive: true });
    await writeFile(args.path, args.content, "utf-8");
    return {
      tool_call_id: "",
      output: `✅ 文件已写入: ${args.path}`,
    };
  } catch (err: unknown) {
    return {
      tool_call_id: "",
      output: `Error: ${(err as Error).message}`,
      is_error: true,
    };
  }
}
