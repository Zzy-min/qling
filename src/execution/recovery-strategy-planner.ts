import type { FailureCategory } from "./types.js";

/** Deterministic recovery choices. Empty lists are deliberate hard stops. */
const STRATEGIES: Record<FailureCategory, readonly string[]> = {
  provider_transient: ["transport_retry"],
  provider_terminal: [],
  invalid_tool_arguments: ["repair_tool_arguments", "return_tool_schema"],
  permission_required: [],
  permission_denied: [],
  sandbox_denied: [],
  tool_not_found: ["inspect_command_environment", "use_supported_command"],
  tool_execution: ["inspect_tool_error", "retry_tool_once", "narrow_tool_scope", "return_tool_diagnostics"],
  verification_failed: ["targeted_verification_repair", "narrow_verification_scope"],
  context_exhausted: ["compact_context_once"],
  repeated_action: [],
  no_progress: [],
  user_canceled: [],
};

export class RecoveryStrategyPlanner {
  list(category: FailureCategory): string[] {
    return [...(STRATEGIES[category] ?? [])];
  }

  next(category: FailureCategory, attempted: readonly string[] = []): string | undefined {
    return this.list(category).find((strategy) => !attempted.includes(strategy));
  }
}
