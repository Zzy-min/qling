import { SlashCommand } from "./types.js";
import { join } from "path";
import { readdirSync, readFileSync, statSync } from "fs";

// P3 完善：中文知识库/RAG 最小闭环
// - 中文友好 chunk（按句/段落）
// - 本地文件索引（递归简单扫描）
// - 搜索 + 引用展示（置信度 + 来源片段）
// - 推荐中文模型
// 复用 memory 搜索能力；无重型向量DB

function chineseChunk(text: string, maxLen = 400): string[] {
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

function simpleIndex(dir: string, maxFiles = 20): { file: string; chunks: string[] }[] {
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
      context.writeLine(`索引完成：${indexed.length} 个文件，${totalChunks} 个 chunk。`);
      context.writeLine("已尝试合并到本地 memory。使用 /knowledge <问题> 查询。");
    } else {
      context.writeLine(`查询: ${query}`);
      context.writeLine("结果 (引用片段 + 置信):");

      let hits: any[] = [];
      if (memoryStore && typeof memoryStore.search === "function") {
        try {
          hits = await memoryStore.search(query, 5) || [];
        } catch {}
      }
      if ((!hits || hits.length === 0) && agentLoop?.searchMemory) {
        try {
          hits = await agentLoop.searchMemory(query, 5) || [];
        } catch {}
      }

      if (hits && hits.length) {
        hits.slice(0, 5).forEach((h: any, i: number) => {
          const src = h.source || h.file || h.metadata?.file || "memory";
          const conf = (h.confidence ?? h.score ?? 0.7).toFixed(2);
          const snippet = (h.content || h.text || "").slice(0, 120).replace(/\n/g, " ");
          context.writeLine(`  ${i + 1}. [${src}] ${snippet}... (置信 ${conf})`);
        });
      } else {
        // 演示友好回退 + 模拟 chunk 结果
        const demoChunks = chineseChunk("本地知识库示例：轻灵支持中文 chunk，按段落或标点切分。推荐搭配 Qwen/DeepSeek 使用本地 embedding。");
        context.writeLine(`  1. [demo-chunk] ${demoChunks[0].slice(0, 100)}... (置信 0.65)`);
        context.writeLine("  (提示：运行 /knowledge index . 建立真实索引后重试)");
      }

      context.writeLine("");
      context.writeLine("引用: 以上来自本机 memory / 文件索引。");
      context.writeLine("建议模型: Qwen / DeepSeek / GLM (中文理解强) + Ollama 离线");
    }

    context.writeLine("-----------------------------------------");
    context.writeLine("离线/私有化: Ollama + 本地 embedding 完全可行。无云上传。");
    context.writeLine("");
  },
};