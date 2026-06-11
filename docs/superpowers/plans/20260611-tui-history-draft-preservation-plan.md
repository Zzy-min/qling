# TUI History Draft Preservation Plan

## Steps

1. Add local draft value and cursor fields to `InputBuffer`.
2. Save the draft before history navigation or matching history search replaces live input.
3. Restore the draft when `historyDown()` returns to the live input position.
4. Reset the draft on `clear()`, `submit()`, and `setHistory()`.
5. Update shortcut help and tests.
6. Run targeted tests, full CI, audit, stale-name scan, then commit and push.

## Risks

- History navigation state can become confusing if draft state survives submit or clear. Reset draft explicitly in those paths.
- Cursor restoration for multiline input must use the saved cursor, not default to the end.
