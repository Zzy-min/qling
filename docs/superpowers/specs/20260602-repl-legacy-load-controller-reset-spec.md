# REPL Legacy Load Controller Reset Spec

## Problem

Classic `qingling repl` supports both slash `/resume` and legacy `!load <name>` session switching. Slash `/resume` resets local session controllers after restoring a session, but legacy `!load` only restores and checkpoints.

After local `/loop` support starts a scheduler timer in classic REPL, this creates a stability leak: a loop created in the previous session can keep running after `!load <name>` restores another session.

## Goals

- Stop and clear local session controllers after successful legacy `!load <name>`.
- Preserve the existing restore and checkpoint behavior.
- Prevent old-session loop timers from triggering model calls after the user switches sessions.
- Keep `!load` without a name as list-only behavior.

## Non-Goals

- Changing slash `/resume` behavior.
- Changing session persistence or restore formats.
- Canceling old tasks on disk; this change only stops the current REPL's old controller timer.
- Changing startup `--resume` or `--continue` behavior.

## Acceptance Criteria

- If a local loop timer is active, a successful `!load <name>` stops it before it can run in the restored session.
- `!load <name>` still calls `restoreSession`, checkpoints on success, and prints the restored session id.
- Failed `!load <name>` does not reset local controllers.
- Targeted REPL tests pass, followed by `npm run ci:check`.
