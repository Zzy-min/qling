# TUI Word Navigation Shortcut Spec

## Goal

Improve local TUI editing ergonomics by supporting word-level cursor movement, matching common terminal agent workflows for fast prompt edits.

## Requirements

- `Alt+Left` and `Alt+Right` move the input cursor to the previous or next word boundary.
- `Alt+B` and `Alt+F` provide the same previous/next word navigation for terminals that send Emacs-style sequences.
- Common `Ctrl+Left` and `Ctrl+Right` CSI sequences are supported when terminals emit them.
- Word navigation only affects the local input buffer cursor.
- Word navigation never submits input, clears input, mutates history, or persists data.
- Shortcut help documents the new word navigation shortcuts.

## Word Boundary Rules

- Moving left first skips whitespace before the cursor, then moves to the beginning of the previous non-whitespace run.
- Moving right first skips the current non-whitespace run, then skips following whitespace, landing at the beginning of the next word or the end of input.
- Newlines count as whitespace.

## Non-Goals

- Do not add word deletion beyond existing `Ctrl+W`.
- Do not implement selection, mouse support, or per-line Home/End behavior.
- Do not change history search or submission semantics.

## Verification

- Unit tests cover `InputBuffer` word-left and word-right behavior, including whitespace and newlines.
- TUI tests cover direct handlers and raw escape sequence dispatch without input submission.
- Shortcut and smoke tests verify help text includes word navigation.
- Full CI, audit, and stale-name scan pass.
