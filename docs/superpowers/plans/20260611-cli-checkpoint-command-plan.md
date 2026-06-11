# CLI Checkpoint Command Plan

## Steps

1. Add RED parser and smoke tests for `checkpoint` and `检查点`.
2. Add a local checkpoint report helper backed by `SessionRegistry`.
3. Wire the new mode into top-level CLI parsing, help text, and `index.ts`.
4. Run targeted tests, full CI, audit old English names, commit, and push.

## Verification

- `npm run build && node --test tests\unit\cli-startup.test.mjs tests\smoke\cli-startup.smoke.test.mjs`
- `npm run ci:check`
- old English-name audit with the established repository scan command
- `git diff --check`
