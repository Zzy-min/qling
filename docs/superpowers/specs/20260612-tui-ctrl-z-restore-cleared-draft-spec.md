# Spec: Restore Ctrl+C-cleared TUI draft with Ctrl+Z

Qling TUI currently protects empty `Ctrl+C` with a double-confirm exit flow, but non-empty `Ctrl+C` immediately clears the current draft. This is local-only and safe, but a mistyped `Ctrl+C` can still destroy an in-progress prompt. Claude Code-like terminal UX should make this reversible.

## Requirements

- When `Ctrl+C` clears a non-empty input buffer, store that cleared draft in memory.
- `Ctrl+Z` restores the latest `Ctrl+C`-cleared draft when the current input buffer is empty.
- Restoring must keep the draft local: do not submit input, do not write input history, do not call the model, and do not persist the draft.
- If there is no restorable draft, `Ctrl+Z` prints a local feedback message and preserves the current input.
- If the current input buffer is non-empty, `Ctrl+Z` must not overwrite it; it should print local feedback.
- Shortcut help documents the new recovery behavior.

## Non-goals

- Do not implement full multi-step undo/redo.
- Do not persist cleared drafts across process restarts.
- Do not change `Ctrl+C` empty-input exit confirmation behavior.

## Verification

- TUI unit tests cover restore, no-draft feedback, and non-empty overwrite protection.
- Shortcut help includes `Ctrl+Z`.
- Full CI passes before push.
