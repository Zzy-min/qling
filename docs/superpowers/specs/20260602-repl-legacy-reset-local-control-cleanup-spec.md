# REPL Legacy Reset Local Control Cleanup Spec

## Problem

Classic `qling repl` still advertises the legacy `!reset` command. After local `/loop` and `/goal` support was added to the classic REPL, `!reset` only resets the in-memory conversation and checkpoints the session.

That creates a stability mismatch: a user can reset the conversation through the documented legacy path while local loop tasks or an active goal remain enabled in the same session.

## Goals

- Make `!reset` and `reset` clean up local REPL control state when local controllers are active.
- Cancel active session loop tasks through the local `SessionScheduler`.
- Clear the active session goal through the local `SessionGoalController`.
- Keep the command local-only and preserve the existing checkpoint behavior.
- Preserve the lightweight behavior when local controllers have not been initialized.

## Non-Goals

- Changing slash `/clear` behavior.
- Changing task or goal persistence formats.
- Adding new top-level CLI commands.
- Changing streaming TUI reset behavior.

## Acceptance Criteria

- After creating a classic REPL `/loop` task, `!reset` marks the local task as canceled and checkpoints the session.
- `!reset` does not call the model path.
- If no local controllers are active, `!reset` still resets and checkpoints as before.
- Targeted REPL tests pass, followed by `npm run ci:check`.
