# Session Checkpoint Command Plan

## Steps

1. Add failing slash command tests for `/checkpoint`, `/检查点`, and help visibility.
2. Implement a focused command module that calls `saveSession(name)` when available, falling back to `checkpointSession()`.
3. Register the command and add focused help metadata.
4. Run targeted tests, then full repository verification and old-name audit.

## Verification

- `npm run build && node --test tests\unit\slash-commands.test.mjs`
- `npm run ci:check`
- old English-name audit with the established repository scan command
- `git diff --check`
