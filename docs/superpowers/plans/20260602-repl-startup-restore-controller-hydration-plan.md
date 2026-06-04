# REPL Startup Restore Controller Hydration Plan

## Implementation Steps

1. Add RED unit tests that seed restored-session loop state and start classic REPL with `resumeSession` and `continueSession`.
2. Verify the seeded loop runs from the restored session's scheduler timer without an input line.
3. In `Repl.start()`, after successful restore and checkpoint, call the existing local controller hydration helper.
4. Preserve ordinary no-restore startup behavior by hydrating only when `restored` is truthy.
5. Verify with targeted REPL tests, related slash/REPL smoke tests, then `npm run ci:check`.

## Risk Controls

- Keep changes scoped to `src/repl.ts`, `tests/unit/repl.test.mjs`, and this spec/plan pair.
- Tests must close the REPL in `finally` to avoid readline or scheduler leaks.
- Do not alter the slash `/resume` or legacy `!load` behavior already covered by tests.
