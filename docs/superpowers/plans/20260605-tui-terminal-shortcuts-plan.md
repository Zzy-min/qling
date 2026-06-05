# TUI Terminal Shortcuts Plan

## Steps

1. Add failing unit tests for word deletion, Home/End escape handling, and `Ctrl+D` exit semantics.
2. Add `InputBuffer.deleteWordBeforeCursor()` with immutable string replacement.
3. Add StreamUI handlers for `Ctrl+W`, `Ctrl+D`, and Home/End escape sequences.
4. Update header help text to describe the current shortcut contract.
5. Verify with targeted tests, full CI, audit, old-name scans, and GitHub push.

## Risk Controls

- Treat all shortcuts as local input edits unless explicitly submitting `exit`.
- Keep `Ctrl+D` conservative: empty input exits, non-empty input does nothing.
- Avoid destructive git or filesystem operations.
