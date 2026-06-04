# Classic REPL Restore Local Status Feedback Spec

## Background

Classic REPL can now route slash commands and hydrate local session controllers after `/resume` and legacy `!load`. The restored loop timer and goal controller work, but the user-facing restore feedback does not consistently show whether local loop tasks or a goal were restored.

Streaming REPL already returns restore metadata with `activeTaskCount` and `activeGoalStatus`, and `/resume` can render those fields when present. Classic REPL should provide the same confidence signal.

## User Journey

As a Qingling user resuming a local session in classic REPL, I want the restore output to show restored local loop and goal state, so that I know whether local automation and goal tracking came back with the session.

## Requirements

1. `/resume [session|latest]` in classic REPL must return restored-session metadata that includes local active loop task count and goal status when local controllers are available.
2. Legacy `!load <name>` must print the same local state summary after a successful restore.
3. Existing restore behavior must remain unchanged for agents that do not expose local runtime methods.
4. Local status counting must exclude canceled and completed tasks, matching streaming REPL.
5. Restore must still checkpoint the restored session and hydrate local controllers before reporting local status.

## Non-Goals

- Change session persistence format.
- Change streaming REPL behavior.
- Add new slash command fields beyond existing `Loop Tasks` and `Goal` render support.
- Run due loop tasks just to compute restore feedback.

## Acceptance Criteria

1. A classic REPL `/resume` test seeds one active loop task and an active goal in the restored session and observes `Loop Tasks : 1` plus `Goal       : active`.
2. A classic REPL `!load` test seeds one active loop task and an active goal in the restored session and observes a restore line containing local loop and goal status.
3. Existing classic REPL restore tests still pass.
4. `npm run ci:check` passes after implementation.
