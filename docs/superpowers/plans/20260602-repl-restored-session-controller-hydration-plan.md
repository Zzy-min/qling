# REPL Restored Session Controller Hydration Plan

## Implementation Steps

1. Add RED unit tests that seed a restored session task file, restore with `/resume` and `!load`, then verify the restored task runs from the timer.
2. Add a helper in `Repl` to rebuild local session controllers for the current `AgentLoop` session id.
3. Use the helper after successful slash `switchSession()` restores.
4. Use the helper after successful legacy `!load <name>` restores.
5. Preserve failed restore behavior and existing checkpoint calls.
6. Verify with targeted REPL tests, related slash/REPL smoke tests, then `npm run ci:check`.

## Risk Controls

- Keep changes scoped to `src/repl.ts`, `tests/unit/repl.test.mjs`, and this spec/plan pair.
- Do not cancel or delete persisted tasks during restore.
- Close the REPL in tests so scheduler timers do not leak.
