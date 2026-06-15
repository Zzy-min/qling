// ============================================================
// 轻灵 - search 工具
// 文件内容搜索（grep）和文件名搜索（glob）
// 优先使用 ripgrep，失败时降级到 Node 原生遍历（带智能忽略与 .gitignore 过滤）
// ============================================================

import { readdir, readFile, stat } from "fs/promises";
import { existsSync, Dirent } from "fs";
import { basename, join, relative } from "path";
import { execFile } from "child_process";
import { ToolDefinition, ToolResult } from "../types.js";
import { getErrorMessage, toolError, toolSuccess } from "./error-utils.js";
import { getRuntimeRootsFromEnv, isWithinAllowedRoots, resolveToolPath } from "../runtime-paths.js";

const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024; // 2MB

const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "out",
  "target",
  ".qling",
  ".idea",
  ".vscode",
  "bin",
  "obj",
]);

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
   - 返回匹配的文件路径列表`,
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
  const pattern = String(args.pattern ?? "").trim();
  if (!pattern) {
    return toolError("SEARCH_EMPTY_PATTERN", "pattern is required");
  }

  const roots = getRuntimeRootsFromEnv();
  const searchPath = args.path ?? roots.workspaceDir ?? roots.fileCacheDir;
  const target = args.target ?? "content";
  if (target !== "content" && target !== "files") {
    return toolError("SEARCH_INVALID_TARGET", `unsupported target: ${target}`);
  }
  const context = clamp(args.context ?? 0, 0, 10);
  const limit = clamp(args.limit ?? 50, 1, 200);
  const absPath = resolveToolPath(searchPath, roots, "workspace");
  if (!isWithinAllowedRoots(absPath, roots)) {
    return toolError("SEARCH_OUTSIDE_ALLOWED_ROOT", `${absPath} is outside allowed roots`);
  }

  try {
    await stat(absPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EACCES" || code === "EPERM") {
      return toolError("SEARCH_PERMISSION_DENIED", `permission denied for ${searchPath}`);
    }
    return toolError("SEARCH_PATH_NOT_FOUND", `path not found: ${searchPath}`);
  }

  // 1. Try Ripgrep first
  const rgResult = await searchWithRipgrep(absPath, pattern, target, args.file_glob, context, limit);
  if (rgResult !== null) {
    return rgResult;
  }

  // 2. Try Git grep fallback
  const gitGrepResult = await searchWithGitGrep(absPath, pattern, target, args.file_glob, context, limit);
  if (gitGrepResult !== null) {
    return gitGrepResult;
  }

  // 3. Fallback to Node.js native search
  try {
    if (target === "files") {
      return await searchFilesNative(absPath, pattern, limit);
    }
    return await searchContentNative(absPath, pattern, args.file_glob, context, limit);
  } catch (err: unknown) {
    return toolError("SEARCH_FAILED", getErrorMessage(err));
  }
}

async function searchWithRipgrep(
  absPath: string,
  pattern: string,
  target: string,
  fileGlob: string | undefined,
  context: number,
  limit: number
): Promise<ToolResult | null> {
  return new Promise((resolve) => {
    let args = ["--color=never"];

    // Add default ignores explicitly to rg
    for (const folder of DEFAULT_IGNORES) {
      args.push("--glob", `!**/${folder}/**`);
    }

    // Add .gitignore explicitly if it exists
    const gitignorePath = join(absPath, ".gitignore");
    if (existsSync(gitignorePath)) {
      args.push("--ignore-file", gitignorePath);
    }

    if (target === "files") {
      args.push("--files");
      if (fileGlob) {
        args.push("--glob", fileGlob);
      }
    } else {
      args.push("--line-number", "--with-filename");
      if (context > 0) {
        args.push("-C", String(context));
      }
      if (fileGlob) {
        args.push("--glob", fileGlob);
      }
      args.push("-e", pattern);
    }
    args.push(absPath);

    execFile("rg", args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as any).code !== 1 && (err as any).code !== 0) {
        // Ripgrep not installed/available, fallback
        resolve(null);
        return;
      }

      const rawLines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (rawLines.length === 0) {
        resolve(toolSuccess("No matches found."));
        return;
      }

      if (target === "files") {
        const flags = process.platform === "win32" ? "i" : "";
        const matcher = globToRegExp(pattern, flags);
        const filteredLines = rawLines.filter(l => matcher.test(basename(l)));
        if (filteredLines.length === 0) {
          resolve(toolSuccess("No files found matching pattern."));
          return;
        }
        const truncated = filteredLines.length > limit;
        const sliced = filteredLines.slice(0, limit);
        const suffix = truncated ? `\n... (truncated at ${limit} results)` : "";
        resolve(toolSuccess(`Found ${truncated ? `${limit}+` : filteredLines.length} file(s):\n${sliced.join("\n")}${suffix}`));
        return;
      }

      // Parse and format content matches uniformly to match Node fallback
      const parsedLines: { file: string; line: number; isMatch: boolean; content: string }[] = [];
      for (const line of rawLines) {
        const m = line.match(/^(.*?)([:-])(\d+)\2(.*)$/);
        if (m) {
          parsedLines.push({
            file: m[1],
            isMatch: m[2] === ":",
            line: parseInt(m[3], 10),
            content: m[4],
          });
        }
      }

      if (context <= 0) {
        const truncated = parsedLines.length > limit;
        const sliced = parsedLines.slice(0, limit);
        const suffix = truncated ? `\n... (truncated at ${limit} results)` : "";
        const formatted = sliced.map(pl => `${pl.file}:${pl.line}:${pl.content}`).join("\n");
        resolve(toolSuccess(`${truncated ? `${limit}+` : parsedLines.length} match(es):\n${formatted}${suffix}`));
        return;
      }

      // Group context blocks
      const fileGroups = new Map<string, typeof parsedLines>();
      for (const pl of parsedLines) {
        if (!fileGroups.has(pl.file)) {
          fileGroups.set(pl.file, []);
        }
        fileGroups.get(pl.file)!.push(pl);
      }

      const formattedBlocks: string[] = [];
      let matchCount = 0;
      let truncated = false;

      for (const [file, fileLines] of fileGroups.entries()) {
        fileLines.sort((a, b) => a.line - b.line);
        const matchesInFile = fileLines.filter(l => l.isMatch);

        for (const matchLine of matchesInFile) {
          matchCount++;
          if (matchCount > limit) {
            truncated = true;
            break;
          }

          const start = matchLine.line - context;
          const end = matchLine.line + context;
          const blockLines = fileLines.filter(l => l.line >= start && l.line <= end);

          const block: string[] = [`${file}:${matchLine.line}:`];
          for (const bl of blockLines) {
            const marker = bl.line === matchLine.line ? ">" : " ";
            block.push(`  ${marker} ${bl.line}: ${bl.content}`);
          }
          formattedBlocks.push(block.join("\n"));
        }

        if (truncated) break;
      }

      const suffix = truncated ? `\n... (truncated at ${limit} results)` : "";
      resolve(toolSuccess(`${truncated ? `${limit}+` : matchCount} match(es):\n${formattedBlocks.join("\n")}${suffix}`));
    });
  });
}

async function loadGitignores(absPath: string): Promise<((p: string) => boolean)[]> {
  const gitignorePath = join(absPath, ".gitignore");
  if (!existsSync(gitignorePath)) return [];
  try {
    const content = await readFile(gitignorePath, "utf-8");
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    return lines.map((line) => {
      let regexStr = line
        .replace(/\./g, "\\.")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");
      if (line.endsWith("/")) {
        regexStr = regexStr + ".*";
      } else {
        regexStr = regexStr + "($|/.*)";
      }
      if (!line.startsWith("/")) {
        regexStr = "(^|/)" + regexStr;
      } else {
        regexStr = "^" + regexStr.slice(1);
      }
      try {
        const regex = new RegExp(regexStr);
        return (p: string) => regex.test(p);
      } catch {
        return () => false;
      }
    });
  } catch {
    return [];
  }
}

async function searchWithGitGrep(
  absPath: string,
  pattern: string,
  target: string,
  fileGlob: string | undefined,
  context: number,
  limit: number
): Promise<ToolResult | null> {
  return new Promise((resolve) => {
    let args: string[] = [];
    if (target === "files") {
      args = ["ls-files", absPath];
      execFile("git", args, { maxBuffer: 10 * 1024 * 1024, cwd: absPath }, (err, stdout, stderr) => {
        if (err) {
          resolve(null);
          return;
        }

        const rawLines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const flags = process.platform === "win32" ? "i" : "";
        const matcher = globToRegExp(pattern, flags);
        const fileMatcher = fileGlob ? globToRegExp(fileGlob, flags) : null;

        const matched: string[] = [];
        for (const line of rawLines) {
          const absFile = join(absPath, line);
          if (fileMatcher && !fileMatcher.test(basename(absFile))) {
            continue;
          }
          if (!matcher.test(basename(absFile))) {
            continue;
          }
          matched.push(absFile);
        }

        if (matched.length === 0) {
          resolve(toolSuccess("No files found matching pattern."));
          return;
        }

        const truncated = matched.length > limit;
        const sliced = matched.slice(0, limit);
        const suffix = truncated ? `\n... (truncated at ${limit} results)` : "";
        resolve(toolSuccess(`Found ${truncated ? `${limit}+` : matched.length} file(s):\n${sliced.join("\n")}${suffix}`));
      });
    } else {
      args = ["grep", "-n", "-I", "--no-color"];
      if (context > 0) {
        args.push("-C", String(context));
      }
      args.push("-e", pattern);

      execFile("git", args, { maxBuffer: 10 * 1024 * 1024, cwd: absPath }, (err, stdout, stderr) => {
        if (err && (err as any).code !== 1 && (err as any).code !== 0) {
          resolve(null);
          return;
        }

        const rawLines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (rawLines.length === 0) {
          resolve(toolSuccess("No matches found."));
          return;
        }

        const parsedLines: { file: string; line: number; isMatch: boolean; content: string }[] = [];
        const flags = process.platform === "win32" ? "i" : "";
        const fileMatcher = fileGlob ? globToRegExp(fileGlob, flags) : null;

        for (const line of rawLines) {
          const m = line.match(/^(.*?)([:-])(\d+)\2(.*)$/);
          if (m) {
            const relativeFile = m[1];
            const absFile = join(absPath, relativeFile);
            if (fileMatcher && !fileMatcher.test(basename(absFile))) {
              continue;
            }
            parsedLines.push({
              file: absFile,
              isMatch: m[2] === ":",
              line: parseInt(m[3], 10),
              content: m[4],
            });
          }
        }

        if (parsedLines.length === 0) {
          resolve(toolSuccess("No matches found."));
          return;
        }

        if (context <= 0) {
          const truncated = parsedLines.length > limit;
          const sliced = parsedLines.slice(0, limit);
          const suffix = truncated ? `\n... (truncated at ${limit} results)` : "";
          const formatted = sliced.map(pl => `${pl.file}:${pl.line}:${pl.content}`).join("\n");
          resolve(toolSuccess(`${truncated ? `${limit}+` : parsedLines.length} match(es):\n${formatted}${suffix}`));
          return;
        }

        // Group context blocks
        const fileGroups = new Map<string, typeof parsedLines>();
        for (const pl of parsedLines) {
          if (!fileGroups.has(pl.file)) {
            fileGroups.set(pl.file, []);
          }
          fileGroups.get(pl.file)!.push(pl);
        }

        const formattedBlocks: string[] = [];
        let matchCount = 0;
        let truncated = false;

        for (const [file, fileLines] of fileGroups.entries()) {
          fileLines.sort((a, b) => a.line - b.line);
          const matchesInFile = fileLines.filter(l => l.isMatch);

          for (const matchLine of matchesInFile) {
            matchCount++;
            if (matchCount > limit) {
              truncated = true;
              break;
            }

            const start = matchLine.line - context;
            const end = matchLine.line + context;
            const blockLines = fileLines.filter(l => l.line >= start && l.line <= end);

            const block: string[] = [`${file}:${matchLine.line}:`];
            for (const bl of blockLines) {
              const marker = bl.line === matchLine.line ? ">" : " ";
              block.push(`  ${marker} ${bl.line}: ${bl.content}`);
            }
            formattedBlocks.push(block.join("\n"));
          }

          if (truncated) break;
        }

        const suffix = truncated ? `\n... (truncated at ${limit} results)` : "";
        resolve(toolSuccess(`${truncated ? `${limit}+` : matchCount} match(es):\n${formattedBlocks.join("\n")}${suffix}`));
      });
    }
  });
}

async function searchFilesNative(absPath: string, pattern: string, limit: number): Promise<ToolResult> {
  const flags = process.platform === "win32" ? "i" : "";
  const matcher = globToRegExp(pattern, flags);
  const matched: string[] = [];
  let truncated = false;
  let budgetExceeded = false;

  try {
    await walkFiles(absPath, async (filePath) => {
      if (!matcher.test(basename(filePath))) {
        return true;
      }
      matched.push(filePath);
      if (matched.length >= limit) {
        truncated = true;
        return false;
      }
      return true;
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "TRAVERSAL_BUDGET_EXCEEDED") {
      budgetExceeded = true;
    } else {
      throw err;
    }
  }

  if (matched.length === 0) {
    if (budgetExceeded) {
      return toolSuccess("No files found matching pattern. (Warning: Traversal budget of 10,000 files was exceeded)");
    }
    return toolSuccess("No files found matching pattern.");
  }

  const suffix = (truncated ? `\n... (truncated at ${limit} results)` : "") +
                 (budgetExceeded ? `\n⚠️ Warning: Search traversal budget of 10,000 files was exceeded. Results may be incomplete.` : "");
  return toolSuccess(
    `Found ${truncated ? `${limit}+` : matched.length} file(s):\n${matched.join("\n")}${suffix}`
  );
}

async function searchContentNative(
  absPath: string,
  pattern: string,
  fileGlob: string | undefined,
  context: number,
  limit: number
): Promise<ToolResult> {
  const flags = process.platform === "win32" ? "i" : "";
  const contentRegex = buildRegex(pattern, flags);
  const fileMatcher = fileGlob ? globToRegExp(fileGlob, flags) : null;
  const outputs: string[] = [];
  let matches = 0;
  let truncated = false;
  let budgetExceeded = false;

  try {
    await walkFiles(absPath, async (filePath) => {
      if (fileMatcher && !fileMatcher.test(basename(filePath))) {
        return true;
      }

      let text: string;
      try {
        const fileStat = await stat(filePath);
        if (fileStat.size > MAX_SEARCH_FILE_BYTES) {
          return true;
        }
        text = await readFile(filePath, "utf-8");
      } catch {
        return true;
      }

      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!contentRegex.test(line)) continue;

        matches++;
        outputs.push(formatMatch(filePath, lines, i, context));
        if (matches >= limit) {
          truncated = true;
          return false;
        }
      }

      return true;
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "TRAVERSAL_BUDGET_EXCEEDED") {
      budgetExceeded = true;
    } else {
      throw err;
    }
  }

  if (matches === 0) {
    if (budgetExceeded) {
      return toolSuccess("No matches found. (Warning: Traversal budget of 10,000 files was exceeded)");
    }
    return toolSuccess("No matches found.");
  }

  const suffix = (truncated ? `\n... (truncated at ${limit} results)` : "") +
                 (budgetExceeded ? `\n⚠️ Warning: Search traversal budget of 10,000 files was exceeded. Results may be incomplete.` : "");
  return toolSuccess(`${truncated ? `${limit}+` : matches} match(es):\n${outputs.join("\n")}${suffix}`);
}

function formatMatch(filePath: string, lines: string[], matchIndex: number, context: number): string {
  if (context <= 0) {
    return `${filePath}:${matchIndex + 1}:${lines[matchIndex]}`;
  }

  const start = Math.max(0, matchIndex - context);
  const end = Math.min(lines.length - 1, matchIndex + context);
  const block: string[] = [`${filePath}:${matchIndex + 1}:`];
  for (let i = start; i <= end; i++) {
    const marker = i === matchIndex ? ">" : " ";
    block.push(`  ${marker} ${i + 1}: ${lines[i]}`);
  }
  return block.join("\n");
}

async function walkFiles(
  rootPath: string,
  onFile: (filePath: string) => Promise<boolean>
): Promise<void> {
  const rootStat = await stat(rootPath);
  if (rootStat.isFile()) {
    await onFile(rootPath);
    return;
  }
  if (!rootStat.isDirectory()) return;

  const gitignores = await loadGitignores(rootPath);

  const stack: string[] = [rootPath];
  let visitCount = 0;
  const TRAVERSAL_BUDGET = 10000;

  while (stack.length > 0) {
    const current = stack.pop()!;
    visitCount++;
    if (visitCount > TRAVERSAL_BUDGET) {
      throw new Error("TRAVERSAL_BUDGET_EXCEEDED");
    }

    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const nameLower = entry.name.toLowerCase();

      // Check default ignores
      if (DEFAULT_IGNORES.has(nameLower)) {
        continue;
      }

      const fullPath = join(current, entry.name);
      const relativePath = relative(rootPath, fullPath).replace(/\\/g, "/");

      // Check gitignore matches
      if (gitignores.some((fn) => fn(relativePath))) {
        continue;
      }

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      visitCount++;
      if (visitCount > TRAVERSAL_BUDGET) {
        throw new Error("TRAVERSAL_BUDGET_EXCEEDED");
      }

      const shouldContinue = await onFile(fullPath);
      if (!shouldContinue) return;
    }
  }
}

function globToRegExp(glob: string, flags = ""): RegExp {
  let pattern = "^";
  for (const ch of glob) {
    if (ch === "*") {
      pattern += ".*";
      continue;
    }
    if (ch === "?") {
      pattern += ".";
      continue;
    }
    pattern += escapeRegExp(ch);
  }
  pattern += "$";
  return new RegExp(pattern, flags);
}

function buildRegex(pattern: string, flags = ""): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    const msg = getErrorMessage(err);
    throw new Error(`[SEARCH_INVALID_REGEX] invalid regex pattern: ${msg}`);
  }
}

function escapeRegExp(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
