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
  /** Resolve inherited credentials at request time; null means offline fallback. */
  getConnection?: () => { apiKey: string; endpoint: string } | null;
}

export class EmbeddingClient {
  private options: EmbeddingOptions;
  private model: string;
  private dimensions?: number;

  constructor(options: EmbeddingOptions) {
    this.options = options;
    this.model = options.model;
    this.dimensions = options.dimensions;
  }

  private currentClient() {
    const options = this.options.getConnection ? this.options.getConnection() : this.options;
    if (!options?.apiKey || options.apiKey.startsWith("qling-auth:")) {
      throw Error("Account embeddings unsupported; configure an independent embedding service credential");
    }
    return axios.create({
      baseURL: options.endpoint,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
    });
  }

  async getEmbedding(text: string): Promise<number[]> {
    try {
      const resp = await this.currentClient().post("/embeddings", {
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
      const resp = await this.currentClient().post("/embeddings", {
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
