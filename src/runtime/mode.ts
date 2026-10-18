export type AgentRuntimeMode = "legacy" | "actor";

export function resolveAgentRuntimeMode(value = process.env.QLING_RUNTIME_MODE): AgentRuntimeMode {
  return String(value ?? "legacy").trim().toLowerCase() === "actor" ? "actor" : "legacy";
}
