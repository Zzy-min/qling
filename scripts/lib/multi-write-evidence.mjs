export function summarizeMultiWriteEvaluation(input) {
  const agents = input.agentResults.map((result) => ({
    ok: !result.is_error,
    error: result.error?.code,
    integratedFiles: result.meta?.integratedFiles ?? [],
    taskId: result.meta?.taskId,
    usage: result.meta?.usageSnapshot,
  }));
  const passed = agents.every((result) => result.ok)
    && input.verifier.ok
    && input.changed.join("|") === "src/math.js|src/text.js"
    && /a \+ b/.test(input.mathSource)
    && /toLowerCase/.test(input.textSource)
    && /pass 2/.test(input.verifier.stdout);
  return {
    eval: "agent-multi-write",
    status: passed ? "pass" : "fail",
    durationMs: input.durationMs,
    agents,
    changed: input.changed,
    verifier: input.verifier,
    independentVerifier: "node --test",
    evidence: {
      executor: "multiple_real_agents",
      model: "real",
      verifier: "environment",
      claim: "Runs two write-capable Qling subagents concurrently in isolated worktrees, serializes owned-file integration, and verifies the combined result independently.",
      limitations: ["Two-agent synthetic repository; does not measure large merge conflicts or more than two concurrent writers."],
    },
  };
}
