# Classic REPL Legacy Load Index Selection Plan

## Scope

Make numbered classic REPL session lists actionable by allowing `!load <number>` to restore the matching local saved session.

## Steps

1. Add RED unit tests in `tests/unit/repl.test.mjs`:
   - detailed metadata path: `!load 2` resolves through `listSessionsDetailed()` and restores the second session;
   - legacy fallback path: `!load 2` resolves through `listSessions()` and restores the second session name.
2. Update `src/repl.ts`:
   - add a small helper that detects positive integer load targets;
   - resolve numeric targets against `listSessionsDetailed()` when available;
   - fall back to `listSessions()` names when detailed metadata is unavailable;
   - keep non-numeric targets unchanged.
3. Keep resolution local-only and read-only; do not inspect saved message bodies.
4. Verify:
   - `npm run build`;
   - `node --test tests\unit\repl.test.mjs`;
   - related REPL/slash/shutdown test combo;
   - `npm run ci:check`.

## Risks

- `!load 1` could be ambiguous if a session is literally named `1`. This plan intentionally favors the displayed list index for positive integers because the list output already presents those as actionable numbers.
- Some test doubles may not expose `listSessionsDetailed()`. The implementation must guard optional methods and preserve `listSessions()` fallback.
