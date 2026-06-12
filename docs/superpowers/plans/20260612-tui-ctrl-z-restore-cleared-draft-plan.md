# Plan: Restore Ctrl+C-cleared TUI draft with Ctrl+Z

1. Add RED tests in `tests/unit/streaming-tui-ctrl-c.test.mjs` for:
   - `Ctrl+C` clearing a draft followed by `Ctrl+Z` restores it.
   - `Ctrl+Z` with no restorable draft prints local feedback and submits nothing.
   - `Ctrl+Z` does not overwrite a non-empty current input.
2. Update `StreamUI` to keep one in-memory cleared-draft slot and dispatch raw `\x1a` to a new `handleCtrlZ()`.
3. Update `src/shortcuts.ts` to document `Ctrl+Z` as a local draft restore shortcut.
4. Run targeted build/tests, then full CI, old-name scan, diff check, and npm audit.
5. Commit and push to `origin/main`.

## Risk controls

- Keep restored drafts out of persistent input history.
- Do not introduce broad undo state that could conflict with regular editing.
- Never overwrite non-empty input when restoring a cleared draft.
