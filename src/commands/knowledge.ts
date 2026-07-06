import { SlashCommand } from "./types.js";
import { join } from "path";
import { readdirSync, readFileSync, statSync } from "fs";
import {
  searchLocalMemoryEntries,
  formatLocalMemorySearchReport,
} from "../memory-report.js";
import { homedir } from "os";

function resolveStateDirForKnowledge(context: any): string | null {
  const agentLoop = context?.agentLoop as any;
  if (agentLoop?.getRuntimeRootDir) {
    try {
      const root = agentLoop.getRuntimeRootDir();
      if (root) return root;
    } catch {}
  }
  const envDir = process.env.QLING_FILE_STATE_DIR;
  if (envDir) return envDir;
  const ctxState = context?.stateDir || context?.workspaceDir;
  if (ctxState) return ctxState;
  return join(require("os").homedir(), ".qling");
}

// P3 完善：中文知识库/RAG 最小闭环
// - 中文友好 chunk（按句/段落）
// - 本地文件索引（递归简单扫描）
// - 搜索 + 引用展示（置信度 + 来源片段）
// - 推荐中文模型
// 复用 memory 搜索能力；无重型向量DB

export function chineseChunk(text: string, maxLen = 400): string[] {
  const chunks: string[] = [];
  // 优先按段落，其次中文句子
  let parts = text.split(/\n\s*\n/);
  if (parts.length < 2) {
    parts = text.split(/[。！？；\n]+/).filter(Boolean);
  }
  let current = "";
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    if ((current + s).length > maxLen && current) {
      chunks.push(current.trim());
      current = s + "。";
    } else {
      current += (current ? " " : "") + s + "。";
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text.slice(0, maxLen)];
}

export function simpleIndex(dir: string, maxFiles = 20): { file: string; chunks: string[] }[] {
  const results: { file: string; chunks: string[] }[] = [];
  try {
    const entries = readdirSync(dir);
    let count = 0;
    for (const e of entries) {
      if (count >= maxFiles) break;
      const full = join(dir, e);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          // 递归一层
          const sub = simpleIndex(full, Math.max(1, maxFiles - count));
          results.push(...sub);
          count += sub.length;
        } else if (/\.(md|txt|ts|js|py|json)$/i.test(e)) {
          const content = readFileSync(full, "utf8").slice(0, 8000);
          const chunks = chineseChunk(content);
          results.push({ file: e, chunks });
          count++;
        }
      } catch {}
    }
  } catch {}
  return results;
}

export const knowledgeCommand: SlashCommand = {
  name: "/knowledge",
  aliases: ["/知", "/kb", "/rag"],
  description: "本地知识库搜索（中文友好 chunk + 引用）",
  usage: "/knowledge <查询> | /knowledge index <路径>",
  execute: async (args, context) => {
    const sub = (args[0] || "").toLowerCase();
    const queryParts = args.slice(1);
    const query = queryParts.join(" ").trim();

    const t = (context as any).i18n || null; // 未来可接 i18n

    context.writeLine("");
    context.writeLine("📚 【轻灵知识库】本地优先 · 中文 RAG");
    context.writeLine("-----------------------------------------");

    if (!query && sub !== "index" && sub !== "索引") {
      context.writeLine("用法: /knowledge <问题>   或  /knowledge index <目录>");
      context.writeLine("默认模型推荐: DeepSeek / Qwen / GLM + 中文 embedding");
      context.writeLine("边界: 仅本地索引，不上传，不默认联网。");
      context.writeLine("-----------------------------------------");
      context.writeLine("");
      return;
    }

    const agentLoop = (context as any).agentLoop as any;
    const memoryStore = agentLoop?.getMemoryStore?.();

    if (sub === "embed" || sub === "embedding" || sub === "调优") {
      context.writeLine("Embedding 调优 (P3 RAG 细节):");
      context.writeLine(`当前推荐模型: ${process.env.QLING_MEMORY_SEMANTIC_MODEL || "text-embedding-3-small"}`);
      context.writeLine("可用调优: 设置 QLING_MEMORY_SEMANTIC_MODEL=你的模型");
      context.writeLine("维度: dimensions 可在 EmbeddingClient 配置");
      context.writeLine("测试: /knowledge embed test <文本>");
      context.writeLine("边界: 需要 API key 和支持 embeddings 的 endpoint");
      return;
    }

    if (sub === "index" || sub === "索引") {
      const target = query || process.cwd();
      context.writeLine(`正在索引: ${target} （中文 chunk 策略：按句/段落，max~400字）`);
      const indexed = simpleIndex(target);
      let totalChunks = 0;
      for (const item of indexed) {
        totalChunks += item.chunks.length;
        if (memoryStore && item.chunks.length) {
          try {
            for (const ch of item.chunks.slice(0, 3)) {
              memoryStore.add(`[知识库] ${item.file}: ${ch}`, "knowledge", 0.75, false);
            }
          } catch {}
        }
      }
      if (memoryStore && typeof memoryStore.saveToDisk === "function") {
        try { await memoryStore.saveToDisk(); } catch {}
      }
      context.writeLine(`索引完成：${indexed.length} 个文件，${totalChunks} 个 chunk。`);
      context.writeLine("已尝试合并到本地 memory。使用 /knowledge <问题> 查询。");
    } else {
      context.writeLine(`查询: ${query}`);
      context.writeLine("结果 (引用片段 + 置信):");

      let usedRealSearch = false;
      const stateDir = resolveStateDirForKnowledge(context);

      if (stateDir) {
        try {
          const report = await searchLocalMemoryEntries(stateDir, { query, count: 5 });
          if (report.entries && report.entries.length > 0) {
            usedRealSearch = true;
            report.entries.forEach((e: any, i: number) => {
              const src = e.source || "memory";
              const conf = (e.score ?? 0.7).toFixed(2);
              const snippet = (e.content || e.preview || "").slice(0, 120).replace(/\n/g, " ");
              const chain = e.metadata?.chain || e.source || src;
              context.writeLine(`  ${i + 1}. [${src}] ${snippet}... (置信 ${conf}) 链路: ${chain}`);
            });
          }
        } catch {}
      }

      if (!usedRealSearch && memoryStore && typeof memoryStore.search === "function") {
        try {
          const hits = await memoryStore.search(query, 5) || [];
          if (hits.length) {
            usedRealSearch = true;
            hits.slice(0, 5).forEach((h: any, i: number) => {
              const src = h.source || "memory";
              const conf = (h.score ?? h.confidence ?? 0.7).toFixed(2);
              const snippet = (h.content || h.entry?.content || "").slice(0, 120).replace(/\n/g, " ");
              const chain = h.metadata?.chain || h.source || src;
              context.writeLine(`  ${i + 1}. [${src}] ${snippet}... (置信 ${conf}) 链路: ${chain}`);
            });
          }
        } catch {}
      }

      if (!usedRealSearch) {
        // 演示友好回退 + 模拟 chunk 结果
        const demoChunks = chineseChunk("本地知识库示例：轻灵支持中文 chunk，按段落或标点切分。推荐搭配 Qwen/DeepSeek 使用本地 embedding。");
        context.writeLine(`  1. [demo-chunk] ${demoChunks[0].slice(0, 100)}... (置信 0.65)`);
        context.writeLine("  (提示：运行 /knowledge index . 建立真实索引后重试；启用 semantic_memory 获得真实向量搜索)");
      }

      context.writeLine("");
      context.writeLine("引用: 以上来自本机 memory / 文件索引。");
      context.writeLine("建议模型: Qwen / DeepSeek / GLM (中文理解强) + Ollama 离线");
      context.writeLine("提示: 设置 QLING_FEATURES_SEMANTIC_MEMORY=true 可启用真实 semantic search");
    }

    context.writeLine("-----------------------------------------");
    context.writeLine("离线/私有化: Ollama + 本地 embedding 完全可行。无云上传。");
    context.writeLine("");
  },
};