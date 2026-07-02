# TUI Compact Long Input Spec

## Summary
Long or multiline TUI drafts must not expand into a multi-row input editor. The input frame should stay stable and show a compact summary chip while preserving the full draft in memory for submission.

## Requirements
- Short single-line input keeps the existing inline rendering.
- Multiline input and visually wrapped long input render as one compact row.
- Pasted multiline input renders as `› [Pasted: <lines> lines]`.
- Typed multiline or long input renders as `› [Draft: <lines> lines, <size>]`.
- Enter submits the full draft, not the summary chip.
- Cursor movement and redraws must keep the cursor inside the input content row.
- Empty Delete/Backspace must not erase terminal history above the input frame.

## Non-Goals
- No slash command behavior changes.
- No session, history, memory, or token storage format changes.
- No full-screen TUI or alternate screen migration.
