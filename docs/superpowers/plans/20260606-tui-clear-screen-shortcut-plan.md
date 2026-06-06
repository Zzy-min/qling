# TUI Ctrl+L Clear Screen Shortcut Plan

## Steps

1. Add a `StreamUI` clear/redraw handler that writes ANSI clear/home, prints the normal header and input bar, and restores cursor position.
2. Wire raw `\x0c` input to the new handler.
3. Update startup shortcut hint and `/shortcuts` help.
4. Add tests proving `Ctrl+L` preserves input, cursor, and callback state.
5. Run targeted tests, full CI gate, audit, stale-name scan, then commit and push.

## Risks

- Cursor restoration can drift if multiline input rendering changes; keep the handler using existing `printInputBar()` and `syncCursor()` helpers.
- Clearing screen must remain local display behavior only; tests must assert no command submission.
