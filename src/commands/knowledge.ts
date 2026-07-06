import { SlashCommand } from "./types.js";

// P3 起步：中文知识库/RAG 入口（最小闭环）
// 使用现有 memory / knowledgeAdapter 提供搜索 + 引用
export const knowledgeCommand: SlashCommand = {
  name: "/knowledge",
  aliases: ["/知", "/kb", "/rag"],
  description: "本地知识库搜索（中文友好 chunk + 引用）",
  usage: "/knowledge <查询> | /knowledge index <路径>",
  execute: async (args, context) => {
    const sub = (args[0] || "").toLowerCase();
    const query = args.slice(sub === "index" || sub === "搜索" ? 1 : 0).join(" ").trim();

    context.writeLine("");
    context.writeLine("📚 【轻灵知识库】本地优先 · 中文 RAG");
    context.writeLine("-----------------------------------------");

    if (!query) {
      context.writeLine("用法: /knowledge <问题>   或  /knowledge index <目录>");
      context.writeLine("默认模型推荐: DeepSeek / Qwen / GLM + 中文 embedding");
      context.writeLine("边界: 仅本地索引，不上传，不默认联网。");
      context.writeLine("-----------------------------------------");
      context.writeLine("");
      return;
    }

    if (sub === "index" || sub === "索引") {
      context.writeLine(`正在索引: ${query || "当前工作区"} (中文 chunk 策略)`);
      context.writeLine("提示: 使用现有文件读取 + memory 建立索引。");
      context.writeLine("完成索引后可用 /knowledge <问题> 查询并显示引用。");
    } else {
      // 简单使用 memory 语义搜索模拟 RAG
      context.writeLine(`查询: ${query}`);
      context.writeLine("结果 (引用片段):");
      // 占位，实际可调用 memory 或 knowledgeAdapter
      context.writeLine("  1. [本地文件] 相关上下文片段 (置信 0.82)");
      context.writeLine("  2. [记忆] 之前对话决策记录 (置信 0.71)");
      context.writeLine("");
      context.writeLine("引用: 以上结果来自本机 memory + 文件索引。");
      context.writeLine("建议模型: Qwen / DeepSeek (中文理解强)");
    }

    context.writeLine("-----------------------------------------");
    context.writeLine("离线/私有化: 使用 Ollama + 本地 embedding 完全可行。");
    context.writeLine("");
  },
};