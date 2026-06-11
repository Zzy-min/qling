# Checkpoint Overwrite Guard Plan

## Steps

1. Add RED tests for CLI checkpoint duplicate refusal, CLI `--force`, slash duplicate refusal, and slash `--force`.
2. Extend checkpoint argument parsing with `force`.
3. Add duplicate-name checks at CLI helper level and slash command level.
4. Run targeted tests, full CI, old English-name audit, and staged checks.

## Verification

- `npm run build && node --test tests\unit\slash-commands.test.mjs tests\smoke\cli-startup.smoke.test.mjs`
- `npm run ci:check`
- old English-name audit with the established repository scan command
- `git diff --check`
