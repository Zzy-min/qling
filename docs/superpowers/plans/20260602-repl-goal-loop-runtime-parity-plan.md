# REPL Goal Loop Runtime Parity Plan

## Implementation Steps

1. Add RED unit tests for classic REPL goal auto-continuation and scheduler timer execution.
2. Extend `Repl.processPrompt()` to mirror streaming TUI goal after-turn behavior with a local prompt loop.
3. Add a small helper that reads `getMessagesSnapshot()` and `getSessionStats()` from the agent and calls `SessionGoalController.afterTurn()`.
4. Start the `SessionScheduler` after lazy local controller initialization.
5. Keep scheduler busy while model turns run, and continue stopping controllers on exit/session switch.
6. Verify with targeted REPL tests, related slash/REPL smoke tests, then `npm run ci:check`.

## Risk Controls

- Keep changes scoped to `src/repl.ts`, `tests/unit/repl.test.mjs`, and this spec/plan pair.
- Mock the goal evaluator through `fetch` in tests; do not depend on network or API keys.
- Use a bounded wait helper for scheduler timer tests and always close the REPL in `finally`.
- Preserve ordinary prompts and legacy `!` command behavior.
