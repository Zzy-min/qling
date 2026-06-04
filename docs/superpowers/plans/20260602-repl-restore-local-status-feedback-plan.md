# Classic REPL Restore Local Status Feedback Plan

## Scope

Expose restored local loop and goal state in classic REPL restore feedback.

## Steps

1. Add test helpers for seeding a session goal alongside existing loop task fixture data.
2. Add RED unit test for `/resume session-new` in classic REPL:
   - restore to a local-runtime-backed session;
   - seed one future active loop task and one active goal;
   - assert slash resume output includes `Loop Tasks : 1` and `Goal       : active`.
3. Add RED unit test for legacy `!load restored`:
   - restore to a local-runtime-backed session;
   - seed one future active loop task and one active goal;
   - assert legacy output includes local loop count and goal status.
4. Update `src/repl.ts`:
   - introduce restored-session local status metadata type;
   - centralize post-restore checkpoint, controller hydration, and local status collection;
   - return enriched metadata from `switchSession`;
   - render local status in `!load` success output.
5. Verify:
   - build before unit tests because tests import `dist`;
   - run `node --test tests\unit\repl.test.mjs`;
   - run related slash/shutdown tests;
   - run `npm run ci:check`.

## Risks

- Hydrating controllers starts the scheduler timer. Tests should seed future `nextRunAt` values for status-only assertions to avoid racing scheduled model runs.
- Agents without local runtime methods must not receive new mandatory method requirements.
