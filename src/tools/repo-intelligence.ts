import type { ToolDefinition, ToolResult } from "../types.js";
import { RepoIndexService } from "../repo-index/service.js";
import { getRuntimeRootsFromEnv } from "../runtime-paths.js";
import { toolError, toolSuccess } from "./error-utils.js";

const services = new Map<string, RepoIndexService>();

function service(): RepoIndexService {
  const roots = getRuntimeRootsFromEnv();
  const workspaceDir = roots.workspaceDir ?? process.cwd();
  const key = `${workspaceDir}\0${roots.fileStateDir}`;
  const existing = services.get(key);
  if (existing) return existing;
  const created = new RepoIndexService({ workspaceDir, stateDir: roots.fileStateDir });
  services.set(key, created);
  if (services.size > 16) services.delete(services.keys().next().value as string);
  return created;
}

export const repoMapTool: ToolDefinition = {
  name: "repo_map",
  description: "Build a token-budgeted structural repository map ranked by definitions, references, tests, and mentioned symbols.",
  parameters: { type: "object", properties: { mentioned: { type: "array", items: { type: "string" } }, token_budget: { type: "number" }, root_cause_id: { type: "string", description: "Efficiency recovery root-cause identifier, when requested." } } },
  readOnly: true, destructive: false, concurrencySafe: false, scenes: ["code", "navigation"], effortHint: "low",
};

export const repoQueryTool: ToolDefinition = {
  name: "repo_query",
  description: "Query the local repository index for files and symbols before reading broad portions of a large codebase.",
  parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" }, root_cause_id: { type: "string", description: "Efficiency recovery root-cause identifier, when requested." } }, required: ["query"] },
  readOnly: true, destructive: false, concurrencySafe: true, scenes: ["code", "navigation"], effortHint: "low",
};

export const impactAnalysisTool: ToolDefinition = {
  name: "impact_analysis",
  description: "Find files, imports, and tests affected by a symbol or file using the local repository graph.",
  parameters: { type: "object", properties: { symbol: { type: "string" }, file: { type: "string" }, limit: { type: "number" }, root_cause_id: { type: "string", description: "Efficiency recovery root-cause identifier, when requested." } } },
  readOnly: true, destructive: false, concurrencySafe: true, scenes: ["code", "verification"], effortHint: "low",
};

export async function runRepoMap(args: { mentioned?: unknown; token_budget?: number }): Promise<ToolResult> {
  try {
    const mentioned = Array.isArray(args.mentioned) ? args.mentioned.map(String) : [];
    const result = await service().renderMap({ mentioned, tokenBudget: args.token_budget });
    return toolSuccess(`[repo-map revision=${result.snapshot.revision} tokens~${result.estimatedTokens} truncated=${result.truncated}]\n${result.text}`);
  } catch (error) { return toolError("REPO_INDEX_FAILED", error instanceof Error ? error.message : String(error)); }
}

export async function runRepoQuery(args: { query?: string; limit?: number }): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) return toolError("REPO_QUERY_INVALID", "query is required");
  try {
    const result = await service().query({ query, limit: args.limit });
    return toolSuccess([
      ...result.symbols.map((symbol) => `${symbol.file}:${symbol.line} ${symbol.kind} ${symbol.signature}`),
      ...result.files.map((file) => `${file.path} rank=${file.rank.toFixed(5)}`),
    ].join("\n") || "(no repository index matches)");
  } catch (error) { return toolError("REPO_QUERY_FAILED", error instanceof Error ? error.message : String(error)); }
}

export async function runImpactAnalysis(args: { symbol?: string; file?: string; limit?: number }): Promise<ToolResult> {
  if (!args.symbol && !args.file) return toolError("IMPACT_INPUT_REQUIRED", "symbol or file is required");
  try {
    const result = await service().impact(args);
    return toolSuccess(`affected files:\n${result.files.map((file) => `- ${file}`).join("\n")}\n\nedges:\n${result.edges.map((edge) => `- ${edge.kind}: ${edge.from} -> ${edge.to}`).join("\n")}`);
  } catch (error) { return toolError("IMPACT_ANALYSIS_FAILED", error instanceof Error ? error.message : String(error)); }
}
