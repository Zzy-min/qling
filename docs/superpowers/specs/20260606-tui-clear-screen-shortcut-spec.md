# TUI Ctrl+L Clear Screen Shortcut Spec

## Goal

Make the local TUI feel closer to mature terminal agents by supporting `Ctrl+L` to clear the visible terminal and redraw the current prompt without losing local input state.

## Requirements

- `Ctrl+L` clears the terminal viewport using ANSI control sequences.
- `Ctrl+L` redraws the standard TUI header, optional status line, and current input prompt.
- `Ctrl+L` preserves the current input buffer and cursor position.
- `Ctrl+L` never submits input and never calls the input callback.
- Shortcut help documents `Ctrl+L` as a local-only screen redraw operation.

## Non-Goals

- Do not delete session history, persistent memory, command history, or exports.
- Do not change agent execution, queue behavior, or tool rendering.
- Do not implement scrollback pruning; terminal scrollback behavior remains terminal-dependent.

## Verification

- Unit coverage for direct `Ctrl+L` handling.
- Unit coverage for raw stdin dispatch of `\x0c`.
- Shortcut help assertions include `Ctrl+L`.
- Full repository gates continue to pass.
