# REPL Legacy Reset Local Control Cleanup Plan

## Implementation Steps

1. Add a RED unit test that creates a local REPL loop task, runs `!reset`, and verifies the task is canceled without model execution.
2. Add a small helper in `Repl` to perform local control cleanup during reset.
3. In the legacy `!reset/reset` branch, call the helper after `agent.reset()` and before checkpointing.
4. Keep cleanup best-effort and local-only so reset remains usable if local controllers were never initialized.
5. Verify with targeted REPL tests, related slash/REPL smoke tests, then `npm run ci:check`.

## Risk Controls

- Keep changes scoped to `src/repl.ts`, `tests/unit/repl.test.mjs`, and this spec/plan pair.
- Do not alter `/clear`; it already performs slash-level cleanup.
- Ensure tests close the REPL so scheduler timers do not leak.
