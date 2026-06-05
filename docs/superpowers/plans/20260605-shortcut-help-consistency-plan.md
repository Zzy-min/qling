# Shortcut Help Consistency Plan

## Steps

1. Add failing assertions for the newly supported shortcuts in slash and CLI smoke tests.
2. Update `SHORTCUT_LINES` to match current TUI behavior.
3. Run targeted tests for slash commands and CLI startup smoke.
4. Run full CI, audit, old-name scans, and push to GitHub.

## Risk Controls

- Limit edits to static help and tests.
- Keep the local data boundary explicit.
- Do not stage environment files or generated build output.
