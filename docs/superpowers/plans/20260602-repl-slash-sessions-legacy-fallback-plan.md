# Classic REPL Slash Sessions Legacy Fallback Plan

## Scope

Make classic REPL `/sessions` robust when only legacy local session listing is available.

## Steps

1. Add RED unit coverage in `tests/unit/repl.test.mjs`:
   - create an agent with `listSessions()` only and explicitly no `listSessionsDetailed`;
   - run `/sessions`;
   - assert it does not error and prints the legacy session name.
2. Update `src/repl.ts`:
   - add a shared local saved-session summary provider for slash context;
   - prefer `listSessionsDetailed()` when present;
   - synthesize minimal `SavedSessionSummary` entries from `listSessions()` names when detailed summaries are absent.
3. Keep `!sessions` and bare `!load` compatibility unchanged.
4. Verify:
   - `npm run build`;
   - `node --test tests\unit\repl.test.mjs`;
   - related REPL/slash/shutdown test combo;
   - `npm run ci:check`.

## Risks

- Synthesized summaries have placeholder timestamps and zero counts. This is acceptable only for legacy fallback and should not replace detailed summaries when available.
- The slash command formats timestamps; use a valid placeholder ISO timestamp to avoid noisy invalid-date output.
