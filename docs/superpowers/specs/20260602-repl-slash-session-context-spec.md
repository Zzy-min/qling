# REPL Slash Session Context Spec

## Problem

`qingling repl` now routes slash commands locally, but it passes only `{ agentLoop }` into the slash dispatcher. Session commands therefore rely on fallback behavior instead of the same explicit context used by the streaming TUI.

The important gap is `/resume`: fallback restore can update in-memory state without checkpointing the restored session, which is weaker than the streaming TUI session switch path.

## Goals

- Give REPL slash commands an explicit local session context.
- Route `/sessions` through an explicit `listSavedSessions` adapter.
- Route `/resume [target]` through an explicit `switchSession` adapter.
- Ensure successful REPL slash resume checkpoints the restored session.
- Preserve ordinary prompt execution and legacy `!` commands.

## Non-Goals

- Adding scheduler or goal controller support to classic REPL.
- Changing streaming TUI behavior.
- Changing slash command output format.
- Changing session snapshot file formats.

## Acceptance Criteria

- `/resume latest` in REPL calls `restoreLatestSession()` and then `checkpointSession()` when restore succeeds.
- `/resume <target>` in REPL calls `restoreSession(target)` and then `checkpointSession()` when restore succeeds.
- `/sessions` in REPL uses local detailed session metadata and does not call the model path.
- Targeted tests pass, followed by `npm run ci:check`.
