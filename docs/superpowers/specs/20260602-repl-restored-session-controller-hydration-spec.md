# REPL Restored Session Controller Hydration Spec

## Problem

Classic `qling repl` can restore sessions through slash `/resume` and legacy `!load <name>`. It now stops old local controllers when switching sessions, but it does not hydrate controllers for the restored session.

That means a restored session with active local loop tasks or an active goal remains inert until another local-control slash command happens to initialize the scheduler and goal controller. The streaming TUI rebuilds these controllers on restore, so the classic REPL still has weaker session continuity.

## Goals

- Hydrate local session controllers after a successful classic REPL session restore.
- Ensure restored-session loop timers can run without requiring another user command.
- Preserve old-controller shutdown before switching to the restored session's controller.
- Keep behavior local-first and use existing task/goal persistence files.

## Non-Goals

- Changing task or goal persistence formats.
- Changing daemon-backed loop/goal behavior.
- Deleting or canceling old-session tasks on disk.
- Changing failed restore behavior.

## Acceptance Criteria

- After `/resume <target>` restores a session that has an active local loop task, that task runs from the restored session's scheduler timer without another input line.
- After `!load <target>` restores a session that has an active local loop task, that task runs from the restored session's scheduler timer without another input line.
- Old-session loop timers do not continue to run after the switch.
- Targeted REPL tests pass, followed by `npm run ci:check`.
