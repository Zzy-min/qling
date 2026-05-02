// ============================================================
// 轻灵 - Embedding 向量生成工具
// 支持 OpenAI / DeepSeek 等主流 Embedding 接口
// ============================================================

import axios from "axios";

export interface EmbeddingOptions {
  apiKey: string;
  endpoint: string;
  model: string;
  dimensions?: number;
}

export class EmbeddingClient {
  private client: any;
  private model: string;
  private dimensions?: number;

  constructor(options: EmbeddingOptions) {
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.client = axios.create({
      baseURL: options.endpoint,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
    });
  }

  async getEmbedding(text: string): Promise<number[]> {
    try {
      const resp = await this.client.post("/embeddings", {
        model: this.model,
        input: text,
        dimensions: this.dimensions, // 仅部分模型支持
      });

      const embedding = resp.data.data?.[0]?.embedding;
      if (!Array.isArray(embedding)) {
        throw new Error("Invalid embedding response format");
      }
      return embedding;
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.message;
      throw new Error(`Embedding failed: ${msg}`);
    }
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    try {
      const resp = await this.client.post("/embeddings", {
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      });

      const embeddings = resp.data.data?.map((d: any) => d.embedding);
      if (!Array.isArray(embeddings)) {
        throw new Error("Invalid embeddings response format");
      }
      return embeddings;
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.message;
      throw new Error(`Batch embedding failed: ${msg}`);
    }
  }
}
