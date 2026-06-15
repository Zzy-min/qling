# TUI showPrompt Duplicate Border Regression Spec

## Problem

After a command finishes and the TUI renders a fresh prompt, the input frame can show an extra top border above the real input box. This leaves a detached `┌───┐` line before the actual framed input and makes the terminal look broken.

## Root Cause

`showPrompt()` manually prints `inputFrameTop()` and then calls `writeInputValue()`. The latter already renders the complete framed input, including top border, content rows, bottom border, multiline hints, and slash completion hints.

## Requirements

- `showPrompt()` must render exactly one complete input frame.
- `writeInputValue()` remains the single renderer for input frame chrome.
- `printInputBar()`, redraw, slash completion, and cursor positioning semantics must not change.
- The fix must preserve pure terminal compatibility and avoid new dependencies.

## Acceptance Criteria

- A regression test fails before the fix when `showPrompt()` emits two top borders.
- The test passes after removing the duplicate top border path.
- Existing frame width, cursor row, empty Delete, slash completion, and multiline input tests still pass.
