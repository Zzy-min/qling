# REPL Slash Session Context Plan

## Implementation Steps

1. Add RED unit tests for REPL `/resume latest` checkpoint behavior and `/sessions` local listing behavior.
2. Add a `createSlashContext()` helper in `src/repl.ts`.
3. Add a `switchSession(target?)` helper that restores the target/latest session and checkpoints on success.
4. Pass the explicit context into `handleSlashCommand()`.
5. Keep normal prompt and legacy `!` command tests green.
6. Run targeted tests, then `npm run ci:check`.

## Risk Controls

- Keep the change scoped to `src/repl.ts` and `tests/unit/repl.test.mjs`.
- Do not alter AgentLoop session registry behavior.
- Do not modify streaming TUI session switching.
