# Classic REPL Legacy Session List Detail Plan

## Scope

Upgrade classic REPL legacy session listing commands to prefer detailed local saved-session metadata while preserving fallback compatibility.

## Steps

1. Add RED unit tests in `tests/unit/repl.test.mjs`:
   - `!sessions` uses `listSessionsDetailed()` when available and prints session id plus counts;
   - bare `!load` uses `listSessionsDetailed()` when available and prints session id plus counts.
2. Update `src/repl.ts`:
   - add a shared legacy session-list rendering helper;
   - prefer `agent.listSessionsDetailed()` if available;
   - fall back to existing `agent.listSessions()` formatting otherwise.
3. Keep the helper read-only and local-only; do not touch message bodies.
4. Verify:
   - `npm run build`;
   - `node --test tests\unit\repl.test.mjs`;
   - related REPL/slash/shutdown test combo;
   - `npm run ci:check`.

## Risks

- Some test agents only implement `listSessions()`. The implementation must guard `listSessionsDetailed` with `typeof`.
- Locale-specific date formatting should not be asserted exactly; tests should assert stable metadata fields such as name, session id, turns, and messages.
