# REPL Local Loop Goal Context Plan

## Implementation Steps

1. Add RED unit tests for REPL `/loop`, `/tasks`, and `/goal`.
2. Add optional scheduler and goal controller fields to `Repl`.
3. Add an async `ensureLocalSessionControllers()` helper that creates local controllers from `AgentLoop.getRuntimeRootDir()` and `AgentLoop.getSessionId()`.
4. Include `scheduler`, `goalController`, `workspaceDir`, and `setImmediatePrompt` in the REPL slash context.
5. Reuse the existing prompt-processing path when `/goal` sets an immediate prompt.
6. Verify with targeted REPL/slash tests, then run `npm run ci:check`.

## Risk Controls

- Keep changes scoped to `src/repl.ts` and `tests/unit/repl.test.mjs`.
- Do not start background timers in tests unless required.
- Do not alter existing slash command implementations.
