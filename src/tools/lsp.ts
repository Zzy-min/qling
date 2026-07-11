// ============================================================
// Phase 4.3 — lsp 工具（可选 TS 语义查询）
// QLING_LSP=1 启用
// ============================================================

import type { ToolDefinition, ToolResult } from "../types.js";
import { toolError, toolSuccess } from "./error-utils.js";
import { getRuntimeRootsFromEnv, isWithinAllowedRoots } from "../runtime-paths.js";
import {
  getOrCreateServiceForFile,
  isLspEnabled,
  loadTypeScript,
  lspDefinition,
  lspDocumentSymbols,
  lspHover,
  lspReferences,
  resetTsServiceCache,
  resolveAbsFile,
} from "../lsp/ts-service.js";

export { isLspEnabled, resetTsServiceCache };

export const lspTool: ToolDefinition = {
  name: "lsp",
  description:
    "Optional TypeScript semantic queries (definition/hover/references/document_symbols). DISABLED by default — set QLING_LSP=1. Uses in-process TypeScript LanguageService (not full multi-language LSP).",
  longDescription: `可选 TypeScript 语义查询（进程内 LanguageService）。

**启用**: \`QLING_LSP=1\`（且环境可 resolve \`typescript\` 包）

**action**:
- definition — 跳转到定义（path + line + character，1-based）
- hover — 类型/文档提示
- references — 查找引用
- document_symbols — 当前文件符号大纲

**限制**: 当前仅 TS/JS 系；非 LSP 多语言协议客户端。通用符号搜索请用 code_symbols。`,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "definition | hover | references | document_symbols",
      },
      path: {
        type: "string",
        description: "File path relative to workspace or absolute",
      },
      line: {
        type: "number",
        description: "1-based line number",
      },
      character: {
        type: "number",
        description: "1-based column (character offset in line)",
      },
      limit: {
        type: "number",
        description: "Max results for references/symbols (default 30/80)",
      },
    },
    required: ["action", "path"],
  },
  scenes: ["code", "navigation"],
  priority: 7,
  readOnly: true,
  destructive: false,
  concurrencySafe: true,
  effortHint: "low",
};

function parseLineChar(args: { line?: number; character?: number }): {
  line: number;
  character: number;
} {
  const line = Number(args.line);
  const character = Number(args.character ?? 1);
  return {
    line: Number.isFinite(line) && line >= 1 ? Math.floor(line) : 1,
    character: Number.isFinite(character) && character >= 1 ? Math.floor(character) : 1,
  };
}

const MAX_LSP_RESULTS = 200;

export function clampLspLimit(raw: unknown, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(MAX_LSP_RESULTS, Math.floor(parsed));
}

export async function runLsp(args: {
  action?: string;
  path?: string;
  line?: number;
  character?: number;
  limit?: number;
}): Promise<ToolResult> {
  if (!isLspEnabled()) {
    return toolError(
      "LSP_DISABLED",
      "lsp 默认关闭。启用: QLING_LSP=1（需可加载 typescript）。通用符号搜索用 code_symbols。",
      { category: "permission" }
    );
  }

  const action = String(args.action ?? "").trim().toLowerCase();
  const allowed = ["definition", "hover", "references", "document_symbols", "symbols"];
  if (!allowed.includes(action)) {
    return toolError(
      "LSP_INVALID_ACTION",
      `action must be one of: definition, hover, references, document_symbols`
    );
  }

  const filePath = String(args.path ?? "").trim();
  if (!filePath) {
    return toolError("LSP_MISSING_PATH", "path is required");
  }

  const ts = await loadTypeScript();
  if (!ts) {
    return toolError(
      "LSP_TYPESCRIPT_MISSING",
      "无法加载 typescript 包。请在项目中安装 typescript（devDependency）后重试。"
    );
  }

  const roots = getRuntimeRootsFromEnv();
  const workspaceDir = roots.workspaceDir ?? process.cwd();
  const abs = resolveAbsFile(workspaceDir, filePath);
  const rootsWithWorkspace = { ...roots, workspaceDir };
  if (!isWithinAllowedRoots(abs, rootsWithWorkspace)) {
    return toolError(
      "LSP_PATH_OUTSIDE_ROOTS",
      `拒绝读取 runtime roots 外文件: ${filePath}`,
      { category: "permission" }
    );
  }

  try {
    const bundle = getOrCreateServiceForFile(ts, workspaceDir, abs);
    const { line, character } = parseLineChar(args);

    if (action === "definition") {
      const locs = lspDefinition(bundle, abs, line, character);
      if (locs.length === 0) {
        return toolSuccess(`lsp definition: (none) at ${filePath}:${line}:${character}`);
      }
      const lines = locs.map(
        (l) =>
          `${l.file}:${l.line}:${l.character}` +
          (l.preview ? `  ${l.preview}` : "")
      );
      return toolSuccess(`lsp definition (${locs.length}):\n${lines.join("\n")}`);
    }

    if (action === "hover") {
      const h = lspHover(bundle, abs, line, character);
      if (!h) {
        return toolSuccess(`lsp hover: (none) at ${filePath}:${line}:${character}`);
      }
      return toolSuccess(
        `lsp hover @ ${filePath}:${line}:${character}\n${h.display}` +
          (h.documentation ? `\n\n${h.documentation}` : "")
      );
    }

    if (action === "references") {
      const limit = clampLspLimit(args.limit, 30);
      const locs = lspReferences(bundle, abs, line, character, limit);
      if (locs.length === 0) {
        return toolSuccess(`lsp references: (none)`);
      }
      const lines = locs.map((l) => `${l.file}:${l.line}:${l.character}`);
      return toolSuccess(`lsp references (${locs.length}):\n${lines.join("\n")}`);
    }

    // document_symbols | symbols
    const limit = clampLspLimit(args.limit, 80);
    const syms = lspDocumentSymbols(bundle, abs, limit);
    if (syms.length === 0) {
      return toolSuccess(`lsp document_symbols: (none) in ${filePath}`);
    }
    const lines = syms.map(
      (s) => `${s.line}:${s.character}  [${s.kind}] ${s.name}`
    );
    return toolSuccess(
      `lsp document_symbols (${syms.length}) ${filePath}:\n${lines.join("\n")}`
    );
  } catch (err) {
    return toolError(
      "LSP_FAILED",
      err instanceof Error ? err.message : String(err),
      { category: "runtime" }
    );
  }
}
