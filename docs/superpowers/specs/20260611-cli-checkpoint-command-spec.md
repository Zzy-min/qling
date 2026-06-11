# CLI Checkpoint Command Spec

## Motivation

Qling now has `/checkpoint` in interactive sessions, but the focused help advertises a CLI form while the top-level parser does not support `qling checkpoint`. This breaks command consistency and weakens local recovery workflows outside the TUI.

## Requirements

- Add top-level `qling checkpoint [name] [--session <session>]`.
- Add Chinese alias `qling 检查点 [name]`.
- The CLI command must not start a model run or require an API key.
- By default, copy the latest local saved session snapshot into a new checkpoint.
- When `--session <session>` is provided, copy that local session snapshot instead.
- If no name is provided, create a timestamped local checkpoint name.
- Output must include source session, saved checkpoint path, turn/message/token metadata, and a local-only boundary.
- Output must not print message bodies.
- Help text, focused help, parser routing, and typo suggestions must include the command.

## Non-Goals

- No mutation of the source snapshot.
- No interactive `/checkpoint` behavior changes.
- No daemon integration.
