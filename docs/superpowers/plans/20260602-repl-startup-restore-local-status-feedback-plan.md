# Classic REPL Startup Restore Local Status Feedback Plan

## Scope

Align classic REPL startup restore feedback with `/resume` and `!load` by showing local loop and goal state after `--resume` and `--continue`.

## Steps

1. Add RED unit coverage in `tests/unit/repl.test.mjs`:
   - startup `resumeSession` with seeded future loop task and active goal must print local restore status;
   - startup `continueSession` with seeded future loop task and active goal must print local restore status.
2. Update `src/repl.ts` startup path:
   - replace duplicate checkpoint/controller hydration with the existing restored-session finalization helper;
   - render startup restore output through the same local status formatting used by legacy restore.
3. Keep non-local test agents compatible by preserving status-less output when no local controllers exist.
4. Verify:
   - `npm run build`;
   - `node --test tests\unit\repl.test.mjs`;
   - related REPL/slash/shutdown test combo;
   - `npm run ci:check`.

## Risks

- Startup tests call `start()`, which enters the prompt loop. Tests must close the REPL after assertions and seed future `nextRunAt` values for output-only status checks to avoid scheduled model runs.
- Reusing the legacy formatter changes startup punctuation slightly; assertions should focus on stable user-visible state fields.
