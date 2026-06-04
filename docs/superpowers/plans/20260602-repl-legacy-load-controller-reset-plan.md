# REPL Legacy Load Controller Reset Plan

## Implementation Steps

1. Add a RED unit test that starts a classic REPL `/loop 1s`, then successfully runs `!load <name>`, waits past the loop interval, and verifies no model run occurs.
2. Keep the test isolated with a dynamic mock session id and close the REPL in `finally`.
3. In the legacy `!load <name>` success branch, call `resetLocalSessionControllers()` after checkpointing the restored session.
4. Preserve failed load behavior so local controllers are not reset when no session is restored.
5. Verify with targeted REPL tests, related slash/REPL smoke tests, then `npm run ci:check`.

## Risk Controls

- Keep changes scoped to `src/repl.ts`, `tests/unit/repl.test.mjs`, and this spec/plan pair.
- Do not change slash `/resume`; it already resets controllers through `switchSession()`.
- Do not delete task state from disk; only stop old in-process timers.
