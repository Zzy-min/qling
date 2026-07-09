import { readFile, writeFile } from "fs/promises";
import { relative } from "path";
import { ToolDefinition, ToolResult } from "../types.js";
import { getErrorMessage, toolError, toolSuccess } from "./error-utils.js";
import {
  checkSensitiveWriteTarget,
  getRuntimeRootsFromEnv,
  isPathAllowedForWrite,
  resolveToolPath,
} from "../runtime-paths.js";

/** 超过该字节数拒绝做 LCS diff / 写入，防止超大文件 OOM */
export const PATCH_MAX_FILE_BYTES = 2 * 1024 * 1024;

export const patchTool: ToolDefinition = {
  name: "patch",
  description:
    "Apply precise search-and-replace edits (chunks) to an existing file. Only writes if all chunks uniquely match. Supports dry_run. Prefer larger unique context blocks.",
  longDescription: `精准局部替换文件内容（补丁）。默认会修改磁盘文件；dry_run=true 时只校验并返回 diff。

**使用场景**:
- 修改文件中的一个或多个函数、变量定义、导入声明等
- 避免重写大文件以节省 Token 资源并提高修改准确率

**工作逻辑**:
- 必须精确匹配 search 字段中的代码段（包括空格、缩进与换行）
- 只有当所有指定的 chunks 在文件中**有且仅有唯一匹配**时，才会将替换内容写入文件（dry_run 除外）
- 任意 chunk 失败则**整次事务不写盘**，并返回诊断上下文 + 建议 search 块
- search 为空、结果无变化（noop）、文件过大均会拒绝

**最佳实践（强烈推荐给 LLM）**:
- 使用包含周围几行的较大唯一块作为 search，而不是孤立的一行。
- 复制时务必 100% 精确，包括所有空白和换行。
- 不确定时，先调用 read 工具获取文件精确内容片段再构造 patch。
- 可用 dry_run=true 先预览 unified diff。`,
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
      dry_run: {
        type: "boolean",
        description: "If true, validate and return unified diff without writing the file",
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
    dry_run: {
      type: "boolean",
      description: "为 true 时只预览 diff，不写盘。",
    },
  },
  examples: [
    'patch path="src/utils.ts" chunks=[{"search":"export const foo = 1;","replace":"export const foo = 2;"}]',
    'patch path="src/utils.ts" dry_run=true chunks=[{"search":"a","replace":"b"}]',
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

export interface PatchLineStats {
  added: number;
  removed: number;
  unchanged: number;
}

export function computeLineStats(originalContent: string, newContent: string): PatchLineStats {
  const originalLines = originalContent.split(/\r?\n/);
  const newLines = newContent.split(/\r?\n/);
  // 简化：按行集合差估算；用于摘要（非完美 LCS 统计）
  let oi = 0;
  let ni = 0;
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  while (oi < originalLines.length && ni < newLines.length) {
    if (originalLines[oi] === newLines[ni]) {
      unchanged++;
      oi++;
      ni++;
      continue;
    }
    // 贪心：优先认为是替换
    const lookAhead = originalLines.indexOf(newLines[ni], oi + 1);
    const lookBack = newLines.indexOf(originalLines[oi], ni + 1);
    if (lookAhead !== -1 && (lookBack === -1 || lookAhead - oi <= lookBack - ni)) {
      removed += lookAhead - oi;
      oi = lookAhead;
    } else if (lookBack !== -1) {
      added += lookBack - ni;
      ni = lookBack;
    } else {
      removed++;
      added++;
      oi++;
      ni++;
    }
  }
  removed += originalLines.length - oi;
  added += newLines.length - ni;
  return { added, removed, unchanged };
}

export async function runPatch(args: {
  path: string;
  chunks: PatchChunk[];
  dry_run?: boolean;
}): Promise<ToolResult> {
  const inputPath = String(args.path ?? "").trim();
  if (!inputPath) {
    return toolError("PATCH_INVALID_PATH", "path is required");
  }

  const chunks = args.chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return toolError("PATCH_INVALID_CHUNKS", "chunks must be a non-empty array");
  }

  const dryRun = args.dry_run === true || String((args as { dryRun?: unknown }).dryRun) === "true";

  const roots = getRuntimeRootsFromEnv();
  const resolvedPath = resolveToolPath(inputPath, roots, "workspace");
  if (!isPathAllowedForWrite(resolvedPath, roots)) {
    return toolError(
      "PATCH_OUTSIDE_ALLOWED_ROOT",
      `${resolvedPath} is outside write sandbox (default: workspace only; set QLING_WRITE_SANDBOX=roots|off to relax)`
    );
  }
  const sensitive = checkSensitiveWriteTarget(resolvedPath);
  if (sensitive?.blocked) {
    return toolError(sensitive.code, sensitive.reason, { category: "permission" });
  }

  let originalContent: string;
  try {
    originalContent = await readFile(resolvedPath, "utf-8");
  } catch (err: unknown) {
    return toolError("PATCH_READ_FAILED", `failed to read file: ${getErrorMessage(err)}`);
  }

  const byteLength = Buffer.byteLength(originalContent, "utf-8");
  if (byteLength > PATCH_MAX_FILE_BYTES) {
    return toolError(
      "PATCH_FILE_TOO_LARGE",
      `file is ${byteLength} bytes; max supported is ${PATCH_MAX_FILE_BYTES} bytes. Use write for large rewrites or split the file.`
    );
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
    if (searchStr === "") {
      return toolError(
        "PATCH_EMPTY_SEARCH",
        `chunk at index ${idx} has empty search; refusing ambiguous full-file match.`
      );
    }

    // Split content to search for occurrences
    const occurrences = countOccurrences(currentContent, searchStr);
    if (occurrences === 0) {
      const ctx = getDiagnosticContext(currentContent, searchStr);
      const suggestion = getSuggestedSearchBlock(currentContent, searchStr);
      let msg = `Chunk index ${idx} search block was not found in the file. Please verify exact spelling, whitespace and indents.\n` +
        `Tip: Use the "read" tool first to get exact text, then copy a unique block.\n` +
        `Search block tried:\n"""\n${searchStr}\n"""\n\n` +
        `Relevant context from file (line numbers):\n"""\n${ctx}\n"""`;

      if (suggestion) {
        msg += `\n\nSuggested exact block from file (copy/adapt this as your search):\n"""\n${suggestion}\n"""`;
      }
      return toolError("PATCH_SEARCH_NOT_FOUND", msg);
    }
    if (occurrences > 1) {
      const ctx = getDiagnosticContext(currentContent, searchStr);
      const suggestion = getSuggestedSearchBlock(currentContent, searchStr);
      let msg = `Chunk index ${idx} search block matches ${occurrences} locations. Please provide more context lines to ensure uniqueness.\n` +
        `Tip: Enlarge the search block with surrounding code until unique.\n` +
        `Search block:\n"""\n${searchStr}\n"""\n\n` +
        `Relevant context from file (line numbers):\n"""\n${ctx}\n"""`;

      if (suggestion) {
        msg += `\n\nSuggested unique block from file (use more context like this):\n"""\n${suggestion}\n"""`;
      }
      return toolError("PATCH_SEARCH_AMBIGUOUS", msg);
    }

    // Uniquely found, execute replacement in simulation
    currentContent = currentContent.replace(searchStr, replaceStr);
  }

  if (currentContent === originalContent) {
    return toolError(
      "PATCH_NOOP",
      "all chunks applied but file content is unchanged (no-op). Refine search/replace or skip this patch."
    );
  }

  const workspaceDir = roots.workspaceDir ?? process.cwd();
  const relFile = relative(workspaceDir, resolvedPath).replace(/\\/g, "/");
  const stats = computeLineStats(originalContent, currentContent);
  const diffText = generateUnifiedDiff(relFile, originalContent, currentContent);
  const summary =
    `summary: chunks=${chunks.length} +${stats.added}/-${stats.removed} lines ` +
    `(unchanged≈${stats.unchanged}) path=${relFile}`;

  if (dryRun) {
    return toolSuccess(
      `🔎 dry_run OK — would apply ${chunks.length} patch chunk(s) to ${resolvedPath}\n` +
        `${summary}\n\n${diffText}\n\n(no file written)`
    );
  }

  // Write changes after all validations pass
  try {
    await writeFile(resolvedPath, currentContent, "utf-8");
    return toolSuccess(
      `✅ Successfully applied ${chunks.length} patch chunk(s) to ${resolvedPath}\n` +
        `${summary}\n\n${diffText}`
    );
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

/**
 * On failure, return a line-numbered snippet around likely matching areas.
 * Helps the LLM construct a better exact search block (Aider-like experience).
 */
function getDiagnosticContext(content: string, searchStr: string, contextLines = 4): string {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return '';

  const searchLines = searchStr.split(/\r?\n/).filter(l => l.trim().length > 0);
  const keyPhrase = searchLines[0]?.trim().slice(0, 40) || '';

  const candidateIdxs: number[] = [];

  // Try direct partial match on first significant line
  if (keyPhrase) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(keyPhrase) || lines[i].trim() === keyPhrase) {
        candidateIdxs.push(i);
      }
    }
  }

  // Fallback: word based match for short unique words
  if (candidateIdxs.length === 0) {
    const words = keyPhrase.split(/\s+/).filter(w => w.length > 4);
    for (let i = 0; i < lines.length; i++) {
      if (words.some(w => lines[i].includes(w))) {
        candidateIdxs.push(i);
        if (candidateIdxs.length >= 3) break;
      }
    }
  }

  if (candidateIdxs.length === 0) {
    // Last resort: head of file
    const preview = lines.slice(0, 12).map((l, i) => `${i + 1}: ${l}`).join('\n');
    return `File head preview:\n${preview}`;
  }

  const idx = candidateIdxs[0];
  const start = Math.max(0, idx - contextLines);
  const end = Math.min(lines.length, idx + contextLines + Math.max(1, searchLines.length));

  let snippet = lines
    .slice(start, end)
    .map((l, j) => `${start + j + 1}: ${l}`)
    .join('\n');

  if (candidateIdxs.length > 1) {
    snippet += `\n... (similar content also near lines: ${candidateIdxs.slice(1, 5).map(n => n + 1).join(', ')})`;
  }

  return snippet;
}

/**
 * 当搜索失败时，尝试找到文件中与 search 最接近的实际代码块，
 * 并返回建议的精确 search 文本（带上下文）。
 * 这能显著帮助 LLM 构造可工作的 patch（类似 Aider 的反馈）。
 */
function getSuggestedSearchBlock(content: string, searchStr: string, contextLines = 2): string | null {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return null;

  const searchTrimmed = searchStr.trim();
  if (!searchTrimmed) return null;

  let bestScore = 0;
  let bestIdx = -1;

  const searchLines = searchStr.split(/\r?\n/).filter(l => l.trim().length > 0);
  const searchWords = searchTrimmed.split(/\s+/).filter(w => w.length > 2);
  const firstSearchLine = searchStr.split(/\r?\n/)[0]?.trim() || '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let score = 0;

    if (firstSearchLine && line.includes(firstSearchLine.slice(0, 30))) {
      score += 20;
    }
    score += searchWords.filter(w => line.includes(w)).length * 3;

    // Bonus for multi-line searches if nearby lines match
    if (searchStr.includes('\n')) {
      const nextSearch = searchStr.split('\n')[1]?.trim();
      if (nextSearch && i + 1 < lines.length && lines[i + 1].includes(nextSearch.slice(0, 20))) {
        score += 15;
      }
    }

    // Deeper: consecutive line overlap score for better multi-line suggestion (Aider style)
    let consecutive = 0;
    for (let k = 0; k < searchLines.length && (i + k) < lines.length; k++) {
      const sline = searchLines[k].trim().toLowerCase();
      const aline = lines[i + k].trim().toLowerCase();
      if (sline && (aline.includes(sline.slice(0, 20)) || sline.includes(aline.slice(0, 20)))) {
        consecutive += 10;
      }
    }
    score += consecutive;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx < 0 || bestScore < 4) return null; // threshold to avoid bad suggestions

  const start = Math.max(0, bestIdx - contextLines);
  const end = Math.min(lines.length, bestIdx + contextLines + 2);

  const block = lines.slice(start, end).join('\n');
  return block;
}

export function generateUnifiedDiff(
  filePath: string,
  originalContent: string,
  newContent: string
): string {
  const originalLines = originalContent.split(/\r?\n/);
  const newLines = newContent.split(/\r?\n/);

  const m = originalLines.length;
  const n = newLines.length;

  // Simple LCS DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (originalLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff items
  interface DiffItem {
    type: "same" | "add" | "delete";
    line: string;
    originalLineNum: number;
    newLineNum: number;
  }
  const diff: DiffItem[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && originalLines[i - 1] === newLines[j - 1]) {
      diff.push({
        type: "same",
        line: originalLines[i - 1],
        originalLineNum: i,
        newLineNum: j
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.push({
        type: "add",
        line: newLines[j - 1],
        originalLineNum: -1,
        newLineNum: j
      });
      j--;
    } else {
      diff.push({
        type: "delete",
        line: originalLines[i - 1],
        originalLineNum: i,
        newLineNum: -1
      });
      i--;
    }
  }
  diff.reverse();

  // Group diff items into hunks with context
  const contextLines = 3;
  const hunks: { start: number; end: number }[] = [];

  let inHunk = false;
  let hunkStart = -1;
  let lastModifiedIdx = -1;

  for (let idx = 0; idx < diff.length; idx++) {
    const isMod = diff[idx].type !== "same";
    if (isMod) {
      if (!inHunk) {
        inHunk = true;
        hunkStart = Math.max(0, idx - contextLines);
      }
      lastModifiedIdx = idx;
    } else {
      if (inHunk && idx - lastModifiedIdx > contextLines * 2) {
        hunks.push({ start: hunkStart, end: lastModifiedIdx + contextLines });
        inHunk = false;
      }
    }
  }
  if (inHunk) {
    hunks.push({ start: hunkStart, end: Math.min(diff.length - 1, lastModifiedIdx + contextLines) });
  }

  // Merge overlapping hunks
  const mergedHunks: { start: number; end: number }[] = [];
  for (const hunk of hunks) {
    if (mergedHunks.length === 0) {
      mergedHunks.push(hunk);
    } else {
      const prev = mergedHunks[mergedHunks.length - 1];
      if (hunk.start <= prev.end) {
        prev.end = Math.max(prev.end, hunk.end);
      } else {
        mergedHunks.push(hunk);
      }
    }
  }

  // Format hunks into standard unified diff format
  const result: string[] = [];
  result.push(`--- ${filePath}`);
  result.push(`+++ ${filePath}`);

  for (const hunk of mergedHunks) {
    const hunkSlice = diff.slice(hunk.start, hunk.end + 1);

    const originalSlice = hunkSlice.filter(x => x.type !== "add");
    const newSlice = hunkSlice.filter(x => x.type !== "delete");

    const originalCount = originalSlice.length;
    const newCount = newSlice.length;

    let originalStart = 0;
    if (originalCount > 0) {
      originalStart = originalSlice[0].originalLineNum;
    } else {
      originalStart = hunk.start > 0 ? diff[hunk.start - 1].originalLineNum : 0;
    }

    let newStart = 0;
    if (newCount > 0) {
      newStart = newSlice[0].newLineNum;
    } else {
      newStart = hunk.start > 0 ? diff[hunk.start - 1].newLineNum : 0;
    }

    result.push(`@@ -${originalStart},${originalCount} +${newStart},${newCount} @@`);
    for (const item of hunkSlice) {
      if (item.type === "same") {
        result.push(` ${item.line}`);
      } else if (item.type === "add") {
        result.push(`+${item.line}`);
      } else {
        result.push(`-${item.line}`);
      }
    }
  }

  return result.join("\n");
}
