# TUI Terminal Shortcuts Spec

## Goal

Make the qling TUI feel closer to native terminal and Claude Code style editing while keeping all behavior local-first and stable.

## Scope

- Support Home/End escape sequences as aliases for moving to the start/end of the current input.
- Support `Ctrl+W` to delete the word before the cursor without submitting.
- Support `Ctrl+D` to submit `exit` only when the input is empty.
- Keep `Ctrl+D` a no-op when the input has content, so it does not accidentally discard user text.
- Update startup help text so displayed shortcuts match supported behavior.

## Non-Goals

- No model calls, tool calls, network access, or disk writes during shortcut handling.
- No shell-like word expansion, quoting, or command parsing.

## Acceptance Criteria

- `InputBuffer.deleteWordBeforeCursor()` removes trailing whitespace and the preceding word before the cursor.
- Home/End move the cursor to the beginning/end through common terminal escape sequences.
- Empty `Ctrl+D` submits `exit` once through the existing input callback.
- Non-empty `Ctrl+D` leaves input and cursor unchanged.
- All new behavior is covered by unit tests.
- Existing `Ctrl+C`, `Ctrl+A/E`, `Ctrl+U/K`, history, and multiline behavior keep passing.
