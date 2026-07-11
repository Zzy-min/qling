// ============================================================
// Phase 4.2 — code_symbols：工作区符号检索（轻量，非完整 LSP）
// ============================================================

import { readdir, readFile } from "fs/promises";
import { existsSync, Dirent } from "fs";
import { join, relative, extname } from "path";
import type { ToolDefinition, ToolResult } from "../types.js";
import { toolError, toolSuccess } from "./error-utils.js";
import { extractSymbols } from "../utils/symbol-extractor.js";
import {
  getRuntimeRootsFromEnv,
  isWithinAllowedRoots,
  resolveToolPath,
} from "../runtime-paths.js";

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

const CODE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".java",
  ".rs",
]);

const MAX_FILES_SCAN = 400;
const MAX_NODES_SCAN = 10_000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_HITS = 40;

export interface SymbolHit {
  file: string;
  name: string;
  type: string;
  line: number;
  signature: string;
}

export const codeSymbolsTool: ToolDefinition = {
  name: "code_symbols",
  description:
    "Search code symbols (functions/classes/types) in the workspace by name pattern. Lightweight regex-based — not a full LSP.",
  longDescription: `在工作区内按名称模式检索代码符号（函数/类/接口/类型等）。

**基于** 静态行正则提取（与 /repomap 同源），**不是** 完整 LSP。
**只读**。适合：定位定义、浏览导出符号。

**参数**:
- query — 名称子串或正则（默认子串，不区分大小写）
- path — 扫描子目录（默认工作区）
- type — 可选过滤：function|class|interface|type|method|struct|variable
- limit — 最多返回条数（默认 30，最大 40）`,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Symbol name substring or regex",
      },
      path: {
        type: "string",
        description: "Directory to scan (default workspace)",
      },
      type: {
        type: "string",
        description: "Optional symbol type filter",
      },
      limit: {
        type: "number",
        description: "Max results (default 30)",
      },
      regex: {
        type: "boolean",
        description: "Treat query as regex (default false)",
      },
    },
    required: ["query"],
  },
  scenes: ["code", "navigation"],
  priority: 7,
  readOnly: true,
  destructive: false,
  concurrencySafe: true,
  effortHint: "low",
};

function compileMatcher(
  query: string,
  asRegex: boolean
): { test: (name: string) => boolean; error?: string } {
  const q = query.trim();
  if (!q) return { test: () => false, error: "empty query" };
  if (asRegex) {
    try {
      const re = new RegExp(q, "i");
      return { test: (name) => re.test(name) };
    } catch (err) {
      return {
        test: () => false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  const lower = q.toLowerCase();
  return { test: (name) => name.toLowerCase().includes(lower) };
}

async function walkCodeFiles(
  root: string,
  onFile: (abs: string) => Promise<void>,
  options: { maxNodes?: number } = {}
): Promise<{ scanned: number; truncated: boolean }> {
  let scanned = 0;
  let visitedNodes = 0;
  let truncated = false;
  const maxNodes = Math.max(1, Math.floor(options.maxNodes ?? MAX_NODES_SCAN));
  const stack = [root];
  while (stack.length > 0) {
    if (scanned >= MAX_FILES_SCAN || visitedNodes >= maxNodes) {
      truncated = true;
      break;
    }
    const current = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visitedNodes++;
      if (visitedNodes > maxNodes) {
        truncated = true;
        break;
      }
      const nameLower = entry.name.toLowerCase();
      if (DEFAULT_IGNORES.has(nameLower)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (!CODE_EXTS.has(ext)) continue;
        scanned++;
        await onFile(full);
        if (scanned >= MAX_FILES_SCAN) {
          truncated = true;
          break;
        }
      }
    }
  }
  return { scanned, truncated };
}

/**
 * 纯函数入口：便于单测。
 */
export async function searchCodeSymbols(options: {
  workspaceDir: string;
  query: string;
  path?: string;
  type?: string;
  limit?: number;
  regex?: boolean;
  /** 内部/测试用遍历节点预算；工具默认 10,000。 */
  maxNodes?: number;
}): Promise<{ hits: SymbolHit[]; scanned: number; truncated: boolean; error?: string }> {
  const workspaceDir = options.workspaceDir || process.cwd();
  const roots = getRuntimeRootsFromEnv({
    ...process.env,
    QLING_WORKSPACE_DIR: workspaceDir,
  });
  // 确保 roots 含 workspace
  const rootsWithWs = {
    ...roots,
    workspaceDir: roots.workspaceDir ?? workspaceDir,
  };

  let scanRoot = workspaceDir;
  if (options.path) {
    const resolved = resolveToolPath(options.path, rootsWithWs);
    if (!isWithinAllowedRoots(resolved, rootsWithWs)) {
      return {
        hits: [],
        scanned: 0,
        truncated: false,
        error: `path outside allowed roots: ${options.path}`,
      };
    }
    scanRoot = resolved;
  }
  if (!existsSync(scanRoot)) {
    return {
      hits: [],
      scanned: 0,
      truncated: false,
      error: `path not found: ${scanRoot}`,
    };
  }

  const matcher = compileMatcher(options.query, Boolean(options.regex));
  if (matcher.error) {
    return { hits: [], scanned: 0, truncated: false, error: matcher.error };
  }

  const typeFilter = options.type?.trim().toLowerCase() || "";
  const limit = Math.min(
    MAX_HITS,
    Math.max(1, Number(options.limit) > 0 ? Math.floor(Number(options.limit)) : 30)
  );
  const hits: SymbolHit[] = [];

  const { scanned, truncated } = await walkCodeFiles(scanRoot, async (abs) => {
    if (hits.length >= limit) return;
    let content: string;
    try {
      const buf = await readFile(abs);
      if (buf.byteLength > MAX_FILE_BYTES) return;
      content = buf.toString("utf8");
    } catch {
      return;
    }
    const ext = extname(abs);
    const symbols = extractSymbols(content, ext);
    const rel = relative(workspaceDir, abs).replace(/\\/g, "/");
    for (const sym of symbols) {
      if (hits.length >= limit) break;
      if (typeFilter && sym.type !== typeFilter) continue;
      if (!matcher.test(sym.name)) continue;
      hits.push({
        file: rel || abs,
        name: sym.name,
        type: sym.type,
        line: sym.line,
        signature: sym.signature.slice(0, 200),
      });
    }
  }, { maxNodes: options.maxNodes });

  return { hits, scanned, truncated };
}

export async function runCodeSymbols(args: {
  query?: string;
  path?: string;
  type?: string;
  limit?: number;
  regex?: boolean;
}): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) {
    return toolError("CODE_SYMBOLS_MISSING_QUERY", "query is required");
  }

  const roots = getRuntimeRootsFromEnv();
  const result = await searchCodeSymbols({
    workspaceDir: roots.workspaceDir ?? process.cwd(),
    query,
    path: args.path,
    type: args.type,
    limit: args.limit,
    regex: args.regex,
  });

  if (result.error) {
    return toolError("CODE_SYMBOLS_FAILED", result.error);
  }

  if (result.hits.length === 0) {
    return toolSuccess(
      `code_symbols: 无匹配 query=${JSON.stringify(query)} scanned=${result.scanned}` +
        (result.truncated ? " (scan truncated)" : "")
    );
  }

  const lines = result.hits.map(
    (h) => `${h.file}:${h.line}  [${h.type}] ${h.name}  ${h.signature}`
  );
  return toolSuccess(
    [
      `code_symbols: ${result.hits.length} hit(s) scanned=${result.scanned}` +
        (result.truncated ? " truncated=true" : ""),
      ...lines,
      "",
      "注: 基于静态提取，非完整 LSP。需要语义跳转可后续启用语言服务。",
    ].join("\n")
  );
}
