import { readFile, writeFile } from "fs/promises";
import { ToolDefinition, ToolResult } from "../types.js";
import { getErrorMessage, toolError, toolSuccess } from "./error-utils.js";
import { getRuntimeRootsFromEnv, isWithinAllowedRoots, resolveToolPath } from "../runtime-paths.js";

export const patchTool: ToolDefinition = {
  name: "patch",
  description:
    "Apply precise search-and-replace edits (chunks) to an existing file. Only writes to the file if all chunks uniquely match.",
  longDescription: `精准局部替换文件内容（补丁）。**会修改磁盘文件**。

**使用场景**:
- 修改文件中的一个或多个函数、变量定义、导入声明等
- 避免重写大文件以节省 Token 资源并提高修改准确率

**工作逻辑**:
- 必须精确匹配 search 字段中的代码段（包括空格、缩进与换行）
- 只有当所有指定的 chunks 在文件中**有且仅有唯一匹配**时，才会将替换内容写入文件。
- 如果任意一个 chunk 未能匹配或匹配到多个位置，将不作任何修改，并返回详细冲突上下文。`,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the target file",
      },
      chunks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            search: {
              type: "string",
              description: "The exact block of code to search for, including leading indent and whitespace",
            },
            replace: {
              type: "string",
              description: "The code to replace it with",
            },
          },
          required: ["search", "replace"],
        },
        description: "List of replacement chunks to apply in sequence",
      },
    },
    required: ["path", "chunks"],
  },
  paramSchema: {
    path: {
      type: "string",
      description: "目标文件路径。相对路径以工作区为基准。",
      minLength: 1,
    },
    chunks: {
      type: "array",
      description: "需要依次执行的精准替换块列表。",
    },
  },
  examples: [
    'patch path="src/utils.ts" chunks=[{"search":"export const foo = 1;","replace":"export const foo = 2;"}]',
  ],
  seeAlso: ["read", "write"],
  scenes: ["coding"],
  priority: 10,
  readOnly: false,
  destructive: false,
  concurrencySafe: false,
  effortHint: "medium",
};

interface PatchChunk {
  search: string;
  replace: string;
}

export async function runPatch(args: {
  path: string;
  chunks: PatchChunk[];
}): Promise<ToolResult> {
  const inputPath = String(args.path ?? "").trim();
  if (!inputPath) {
    return toolError("PATCH_INVALID_PATH", "path is required");
  }

  const chunks = args.chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return toolError("PATCH_INVALID_CHUNKS", "chunks must be a non-empty array");
  }

  const roots = getRuntimeRootsFromEnv();
  const resolvedPath = resolveToolPath(inputPath, roots, "workspace");
  if (!isWithinAllowedRoots(resolvedPath, roots)) {
    return toolError("PATCH_OUTSIDE_ALLOWED_ROOT", `${resolvedPath} is outside allowed roots`);
  }

  let originalContent: string;
  try {
    originalContent = await readFile(resolvedPath, "utf-8");
  } catch (err: unknown) {
    return toolError("PATCH_READ_FAILED", `failed to read file: ${getErrorMessage(err)}`);
  }

  // Work with a copy/simulation to check all matches before writing
  let currentContent = originalContent;

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const searchStr = chunk.search;
    const replaceStr = chunk.replace;

    if (searchStr === undefined || replaceStr === undefined) {
      return toolError("PATCH_INVALID_CHUNK", `chunk at index ${idx} is missing search or replace field`);
    }

    // Split content to search for occurrences
    const occurrences = countOccurrences(currentContent, searchStr);
    if (occurrences === 0) {
      return toolError(
        "PATCH_SEARCH_NOT_FOUND",
        `Chunk index ${idx} search block was not found in the file. Please verify exact spelling, whitespace and indents.\nSearch block:\n"""\n${searchStr}\n"""`
      );
    }
    if (occurrences > 1) {
      return toolError(
        "PATCH_SEARCH_AMBIGUOUS",
        `Chunk index ${idx} search block matches ${occurrences} locations. Please provide more context lines to ensure uniqueness.\nSearch block:\n"""\n${searchStr}\n"""`
      );
    }

    // Uniquely found, execute replacement in simulation
    currentContent = currentContent.replace(searchStr, replaceStr);
  }

  // Write changes after all validations pass
  try {
    await writeFile(resolvedPath, currentContent, "utf-8");
    return toolSuccess(`✅ Successfully applied ${chunks.length} patch chunk(s) to ${resolvedPath}`);
  } catch (err: unknown) {
    return toolError("PATCH_WRITE_FAILED", `failed to write file: ${getErrorMessage(err)}`);
  }
}

function countOccurrences(text: string, searchStr: string): number {
  if (!searchStr) return 0;
  let count = 0;
  let pos = text.indexOf(searchStr);
  while (pos !== -1) {
    count++;
    pos = text.indexOf(searchStr, pos + searchStr.length);
  }
  return count;
}
