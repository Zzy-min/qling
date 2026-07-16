import type { MCPToolDefinition } from "./types.js";

export interface ToolCatalogMatch {
  fullName: string;
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  score: number;
}

function terms(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, " ")
    .split(/\s+/)
    .flatMap((token) => token.split(/[_-]+/))
    .filter((token) => token.length > 1);
}

export class ToolCatalog {
  private tools: MCPToolDefinition[] = [];
  private docs: Array<{ tool: MCPToolDefinition; terms: string[] }> = [];
  private documentFrequency = new Map<string, number>();

  replace(tools: MCPToolDefinition[]): void {
    this.tools = [...tools];
    this.docs = this.tools.map((tool) => ({
      tool,
      terms: terms(
        `${tool.serverName} ${tool.name} ${tool.description} ${JSON.stringify(tool.inputSchema)}`
      ),
    }));
    this.documentFrequency.clear();
    for (const doc of this.docs) {
      for (const term of new Set(doc.terms)) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
    }
  }

  size(): number {
    return this.tools.length;
  }

  get(fullName: string): MCPToolDefinition | undefined {
    const normalized = fullName.replace(/^mcp__/, "");
    const separator = normalized.indexOf("__");
    if (separator < 1) return undefined;
    const serverName = normalized.slice(0, separator);
    const name = normalized.slice(separator + 2);
    return this.tools.find((tool) => tool.serverName === serverName && tool.name === name);
  }

  search(query: string, limit = 5): ToolCatalogMatch[] {
    const queryTerms = terms(query);
    if (queryTerms.length === 0) return [];
    const docCount = Math.max(1, this.docs.length);
    const avgLength =
      this.docs.reduce((sum, doc) => sum + doc.terms.length, 0) / docCount || 1;
    const k1 = 1.2;
    const b = 0.75;
    const scored = this.docs.map((doc) => {
      const frequencies = new Map<string, number>();
      for (const term of doc.terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      let score = 0;
      for (const term of queryTerms) {
        const tf = frequencies.get(term) ?? 0;
        if (tf === 0) continue;
        const df = this.documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc.terms.length / avgLength))));
      }
      const exactName = doc.tool.name.toLowerCase().includes(query.toLowerCase()) ? 2 : 0;
      return { doc, score: score + exactName };
    });
    return scored
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.doc.tool.serverName.localeCompare(b.doc.tool.serverName) ||
          a.doc.tool.name.localeCompare(b.doc.tool.name)
      )
      .slice(0, Math.max(1, Math.min(20, Math.floor(limit))))
      .map(({ doc, score }) => ({
        fullName: `mcp__${doc.tool.serverName}__${doc.tool.name}`,
        serverName: doc.tool.serverName,
        name: doc.tool.name,
        description: doc.tool.description,
        inputSchema: doc.tool.inputSchema,
        score,
      }));
  }
}
