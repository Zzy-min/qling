import type { ToolDefinition } from "../types.js";
import type { ToolSideEffect } from "../runtime/types.js";

export type ToolRisk = "low" | "medium" | "high" | "critical";
export type ToolPermission = "allow" | "ask" | "deny";

export interface ToolCapability extends ToolDefinition {
  sideEffect: ToolSideEffect;
  risk: ToolRisk;
  reversible: boolean;
  idempotent: boolean;
  cancellable: boolean;
  timeoutPolicy?: { defaultMs: number; maxMs: number };
  concurrencyPolicy: "parallel" | "serial" | "exclusive";
  requiredCapabilities: string[];
  outputKind: "text" | "structured" | "artifact" | "stream";
  artifactPolicy: "inline" | "offload_large" | "always_offload";
  permission: ToolPermission;
}

export interface ToolInvocation {
  name: string;
  arguments: Record<string, unknown>;
  definition?: ToolDefinition;
}

const READ_ONLY_BASH = /^pwd$/i;
const SHELL_COMPOSITION = /(?:[;&|><\r\n]|\$\(|`|%[A-Za-z_][A-Za-z0-9_]*%)/;
const EXTERNAL_BASH = /\b(?:git\s+push|gh\s+(?:pr\s+(?:create|merge|comment)|issue\s+(?:create|close|comment))|npm\s+publish|curl\b[^\r\n]*(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE))\b/i;
const DESTRUCTIVE_BASH = /\b(?:rm\s+-rf|del\s+\/|remove-item\b[^\r\n]*-recurse|git\s+reset\s+--hard|git\s+clean\s+-fd|drop\s+(?:table|database))\b/i;
const PACKAGE_INSTALL_BASH = /\b(?:(?:python(?:\d+(?:\.\d+)?)?(?:\.exe)?\s+-m\s+|uv(?:\.exe)?\s+)?pip\d*(?:\.exe)?\s+install|pipx(?:\.exe)?\s+install|npm(?:\.cmd|\.exe)?\s+(?:install|i|ci)(?:\s|$)|pnpm(?:\.cmd|\.exe)?\s+(?:install|add)(?:\s|$)|yarn(?:\.cmd|\.exe)?\s+(?:install|add)(?:\s|$)|bun(?:\.exe)?\s+(?:install|add)(?:\s|$)|uv(?:\.exe)?\s+(?:add|sync)(?:\s|$)|poetry(?:\.exe)?\s+(?:install|add)(?:\s|$)|conda(?:\.exe)?\s+install(?:\s|$)|cargo(?:\.exe)?\s+install(?:\s|$)|go(?:\.exe)?\s+install(?:\s|$)|dotnet(?:\.exe)?\s+add\s+package(?:\s|$)|gem(?:\.cmd|\.exe)?\s+install(?:\s|$)|composer(?:\.bat)?\s+require(?:\s|$)|winget(?:\.exe)?\s+install(?:\s|$)|choco(?:\.exe)?\s+install(?:\s|$)|scoop(?:\.cmd|\.ps1)?\s+install(?:\s|$))\b/i;
const WORKSPACE_MUTATION_BASH = /\b(?:git\s+(?:add|commit|checkout|switch|merge|rebase|restore)|npm\s+(?:install|uninstall)|pnpm\s+(?:add|remove)|yarn\s+(?:add|remove)|mv|move|cp|copy|mkdir|new-item|set-content)\b/i;
const NETWORK_BASH = /\b(?:curl|wget|invoke-webrequest|ssh|scp|npm\s+(?:view|info)|gh\s+(?:api|repo\s+view))\b/i;

function normalizeLeadingExecutable(command: string): string {
  const trimmed = command.trim().replace(/^&\s+/, "");
  const quoted = trimmed.match(/^(["'])(.*?)\1(.*)$/s);
  const bare = quoted ? undefined : trimmed.match(/^(\S+)(.*)$/s);
  const executable = quoted?.[2] ?? bare?.[1];
  const remainder = quoted?.[3] ?? bare?.[2] ?? "";
  if (!executable) return trimmed;
  const basename = executable.split(/[\\/]/).at(-1) ?? executable;
  const normalized = basename.replace(/\.(?:exe|cmd|bat|ps1)$/i, "");
  return `${normalized}${remainder}`.trim();
}

function defaultsFor(definition: ToolDefinition): ToolCapability {
  const readOnly = definition.readOnly === true;
  return {
    ...definition,
    sideEffect: readOnly ? "none" : "workspace",
    risk: readOnly ? "low" : "high",
    reversible: readOnly,
    idempotent: readOnly,
    cancellable: false,
    concurrencyPolicy: definition.concurrencySafe ? "parallel" : "serial",
    requiredCapabilities: [],
    outputKind: "text",
    artifactPolicy: "offload_large",
    permission: readOnly ? "allow" : "ask",
  };
}

export function classifyToolInvocation(invocation: ToolInvocation): ToolCapability {
  const base = invocation.definition
    ? defaultsFor(invocation.definition)
    : defaultsFor({ name: invocation.name, description: invocation.name, parameters: {} });
  if (invocation.name !== "bash") return base;

  const command = String(invocation.arguments.command ?? invocation.arguments.cmd ?? "").trim();
  const injectedEnv = invocation.arguments.env_inject;
  const allowedEnv = invocation.arguments.env_allowlist;
  const hasInjectedEnv = Boolean(
    (injectedEnv && typeof injectedEnv === "object" && Object.keys(injectedEnv as Record<string, unknown>).length > 0) ||
    (Array.isArray(allowedEnv) && allowedEnv.length > 0) ||
    (allowedEnv && typeof allowedEnv === "object" && Object.keys(allowedEnv as Record<string, unknown>).length > 0)
  );
  const commandForCapability = normalizeLeadingExecutable(command);
  if (DESTRUCTIVE_BASH.test(commandForCapability)) {
    return { ...base, sideEffect: "workspace", risk: "critical", reversible: false, idempotent: false, cancellable: true, concurrencyPolicy: "exclusive", permission: "ask" };
  }
  if (EXTERNAL_BASH.test(commandForCapability)) {
    return { ...base, sideEffect: "external", risk: "critical", reversible: false, idempotent: false, cancellable: true, concurrencyPolicy: "exclusive", permission: "ask" };
  }
  if (PACKAGE_INSTALL_BASH.test(commandForCapability)) {
    return { ...base, sideEffect: "network", risk: "high", reversible: false, idempotent: false, cancellable: true, concurrencyPolicy: "exclusive", permission: "ask" };
  }
  if (READ_ONLY_BASH.test(commandForCapability) && !hasInjectedEnv && !SHELL_COMPOSITION.test(commandForCapability) && !WORKSPACE_MUTATION_BASH.test(commandForCapability)) {
    return { ...base, sideEffect: "none", risk: "low", reversible: true, idempotent: true, cancellable: true, concurrencyPolicy: "parallel", permission: "allow" };
  }
  if (WORKSPACE_MUTATION_BASH.test(commandForCapability)) {
    return { ...base, sideEffect: "workspace", risk: "medium", reversible: true, idempotent: false, cancellable: true, concurrencyPolicy: "exclusive", permission: "ask" };
  }
  if (NETWORK_BASH.test(commandForCapability)) {
    return { ...base, sideEffect: "network", risk: "medium", reversible: true, idempotent: true, cancellable: true, concurrencyPolicy: "serial", permission: "ask" };
  }
  return { ...base, sideEffect: "process", risk: "high", reversible: false, idempotent: false, cancellable: true, concurrencyPolicy: "exclusive", permission: "ask" };
}

export class ToolCapabilityRegistry {
  private readonly tools = new Map<string, ToolCapability>();

  constructor(definitions: ToolDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: ToolDefinition): ToolCapability {
    const capability = defaultsFor(definition);
    this.tools.set(definition.name, capability);
    return capability;
  }

  get(name: string): ToolCapability {
    return this.tools.get(name) ?? defaultsFor({ name, description: name, parameters: {} });
  }

  search(query: string, limit = 8): ToolCapability[] {
    const tokenize = (value: string): string[] => value
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^\p{L}\p{N}_]+/u)
      .filter(Boolean);
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const documents = [...this.tools.values()].map((tool) => {
      const text = `${tool.name.replace(/_/g, " ")} ${tool.name} ${tool.description} ${tool.longDescription ?? ""} ${(tool.scenes ?? []).join(" ")}`;
      const terms = tokenize(text);
      return { tool, terms, frequencies: new Map(terms.map((term) => [term, terms.filter((candidate) => candidate === term).length])) };
    });
    const documentFrequency = new Map<string, number>();
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, documents.filter((document) => document.frequencies.has(token)).length);
    }
    const averageLength = documents.reduce((sum, document) => sum + document.terms.length, 0) / Math.max(1, documents.length);
    const k1 = 1.2;
    const b = 0.75;
    return documents
      .map(({ tool, terms, frequencies }) => {
        let score = 0;
        for (const token of tokens) {
          const frequency = frequencies.get(token) ?? 0;
          if (frequency === 0) continue;
          const df = documentFrequency.get(token) ?? 0;
          const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
          score += idf * (frequency * (k1 + 1)) / (frequency + k1 * (1 - b + b * terms.length / Math.max(1, averageLength)));
        }
        const normalizedName = tool.name.toLowerCase();
        if (normalizedName === query.trim().toLowerCase()) score += 20;
        else if (tokens.every((token) => normalizedName.includes(token))) score += 5;
        return { tool, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || (right.tool.priority ?? 5) - (left.tool.priority ?? 5) || left.tool.name.localeCompare(right.tool.name))
      .slice(0, Math.max(1, limit))
      .map((entry) => entry.tool);
  }
}

const CORE_TOOL_NAMES = new Set([
  "bash",
  "read",
  "write",
  "patch",
  "read_anchored",
  "patch_anchored",
  "repo_map",
  "repo_query",
  "impact_analysis",
  "verify",
  "bg_list",
  "bg_wait",
  "bg_kill",
  "bg_reconcile",
  "tool_search",
  "search_tool",
  "use_tool",
]);

export function selectToolsForRequest(
  definitions: ToolDefinition[],
  query: string,
  limit = 8
): ToolDefinition[] {
  const registry = new ToolCapabilityRegistry(definitions);
  const selected = new Set<string>(CORE_TOOL_NAMES);
  for (const tool of registry.search(query, limit)) selected.add(tool.name);
  return definitions.filter((tool) => selected.has(tool.name));
}
