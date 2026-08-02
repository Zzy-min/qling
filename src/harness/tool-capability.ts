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
const WORKSPACE_MUTATION_BASH = /\b(?:git\s+(?:add|commit|checkout|switch|merge|rebase|restore)|npm\s+(?:install|uninstall)|pnpm\s+(?:add|remove)|yarn\s+(?:add|remove)|mv|move|cp|copy|mkdir|new-item|set-content)\b/i;
const NETWORK_BASH = /\b(?:curl|wget|invoke-webrequest|ssh|scp|npm\s+(?:view|info)|gh\s+(?:api|repo\s+view))\b/i;

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
  if (DESTRUCTIVE_BASH.test(command)) {
    return { ...base, sideEffect: "workspace", risk: "critical", reversible: false, idempotent: false, cancellable: true, concurrencyPolicy: "exclusive", permission: "ask" };
  }
  if (EXTERNAL_BASH.test(command)) {
    return { ...base, sideEffect: "external", risk: "critical", reversible: false, idempotent: false, cancellable: true, concurrencyPolicy: "exclusive", permission: "ask" };
  }
  if (READ_ONLY_BASH.test(command) && !hasInjectedEnv && !SHELL_COMPOSITION.test(command) && !WORKSPACE_MUTATION_BASH.test(command)) {
    return { ...base, sideEffect: "none", risk: "low", reversible: true, idempotent: true, cancellable: true, concurrencyPolicy: "parallel", permission: "allow" };
  }
  if (WORKSPACE_MUTATION_BASH.test(command)) {
    return { ...base, sideEffect: "workspace", risk: "medium", reversible: true, idempotent: false, cancellable: true, concurrencyPolicy: "exclusive", permission: "ask" };
  }
  if (NETWORK_BASH.test(command)) {
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
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return [...this.tools.values()]
      .map((tool) => {
        const haystack = `${tool.name} ${tool.description} ${tool.longDescription ?? ""} ${(tool.scenes ?? []).join(" ")}`.toLowerCase();
        const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
        return { tool, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || (right.tool.priority ?? 5) - (left.tool.priority ?? 5) || left.tool.name.localeCompare(right.tool.name))
      .slice(0, Math.max(1, limit))
      .map((entry) => entry.tool);
  }
}
