import { SlashCommand } from "./types.js";
import { readdir, readFile, stat } from "fs/promises";
import { existsSync, Dirent } from "fs";
import { join, relative, extname } from "path";
import { extractSymbols } from "../utils/symbol-extractor.js";

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

async function walkFiles(rootPath: string, onFile: (filePath: string) => Promise<void>): Promise<void> {
  const stack: string[] = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const nameLower = entry.name.toLowerCase();
      if (DEFAULT_IGNORES.has(nameLower)) {
        continue;
      }
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        await onFile(fullPath);
      }
    }
  }
}

export const repomapCommand: SlashCommand = {
  name: "/repomap",
  aliases: ["/代码地图"],
  description: "扫描项目文件并生成符号地图（Repo Map）",
  usage: "/repomap [path] [limit]",
  category: "memory",
  argumentHint: "[path] [limit]",
  examples: ["/repomap", "/repomap src/ 20"],
  execute: async (args, context) => {
    const agentLoop = context.agentLoop;
    const workspaceDir = context.workspaceDir ?? (agentLoop as any).getWorkspaceDir?.() ?? process.cwd();

    let scanPath = workspaceDir;
    let limit = 50;

    if (args.length > 0) {
      if (/^\d+$/.test(args[0])) {
        limit = parseInt(args[0], 10);
      } else {
        scanPath = join(workspaceDir, args[0]);
        if (args.length > 1 && /^\d+$/.test(args[1])) {
          limit = parseInt(args[1], 10);
        }
      }
    }

    if (!existsSync(scanPath)) {
      context.writeError(`❌ Scan path does not exist: ${scanPath}`);
      return;
    }

    context.writeLine(`🔍 Scanning files for symbols under ${scanPath}...`);

    const memoryStore = (agentLoop as any).getMemoryStore?.();
    const cognitiveIndex = memoryStore?.getCognitiveIndex?.();

    const allowedExtensions = new Set([".ts", ".js", ".tsx", ".jsx", ".py", ".go"]);
    const fileSymbolMap = new Map<string, any[]>();
    let fileCount = 0;

    await walkFiles(scanPath, async (filePath) => {
      const ext = extname(filePath).toLowerCase();
      if (!allowedExtensions.has(ext)) return;

      const relPath = relative(workspaceDir, filePath).replace(/\\/g, "/");

      try {
        const content = await readFile(filePath, "utf-8");
        const symbols = extractSymbols(content, ext);

        if (symbols.length > 0) {
          fileSymbolMap.set(relPath, symbols);

          // Index symbols in CognitiveIndex if available
          if (cognitiveIndex) {
            cognitiveIndex.clearSymbolsForFile(relPath);
            for (const sym of symbols) {
              cognitiveIndex.upsertSymbolNode(relPath, sym);
            }
          }
        }
      } catch (err) {
        // Skip unreadable files
      }
    });

    context.writeLine(`\n=== 🗺️  Repository Symbol Map (Showing up to ${limit} files) ===`);
    const sortedFiles = Array.from(fileSymbolMap.keys()).sort();
    const slicedFiles = sortedFiles.slice(0, limit);

    for (const file of slicedFiles) {
      context.writeLine(`📄 ${file}`);
      const symbols = fileSymbolMap.get(file)!;
      for (const sym of symbols) {
        context.writeLine(`  [${sym.type}] L${sym.line}: ${sym.name}`);
      }
    }

    if (sortedFiles.length > limit) {
      context.writeLine(`... and ${sortedFiles.length - limit} more files.`);
    }

    if (cognitiveIndex) {
      context.writeLine(`\n✅ Successfully indexed ${fileSymbolMap.size} files in persistent memory.`);
    }
  },
};
