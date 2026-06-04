# REPL Startup Restore Controller Hydration Spec

## Problem

Classic `qling repl` accepts startup restore options through `--resume <id>` and `--continue`. The startup path restores and checkpoints the session, but it does not hydrate the local session scheduler and goal controller.

As a result, a restored session with active local loop tasks or an active goal does not continue running until the user enters another local-control slash command. This weakens local-first session continuity compared with the streaming TUI and with explicit in-REPL `/resume` or `!load`.

## Goals

- Hydrate local session controllers after a successful classic REPL startup restore.
- Ensure restored local loop tasks can run from the scheduler timer without another input line.
- Preserve ordinary startup behavior when no session is restored.
- Keep all restored task and goal state in the existing local runtime directories.

## Non-Goals

- Starting local controllers on ordinary classic REPL startup when no session was restored.
- Changing streaming TUI behavior.
- Changing task or goal persistence formats.
- Changing daemon-backed task behavior.

## Acceptance Criteria

- `new Repl(agent, { resumeSession })` followed by `start()` hydrates the restored session controller when restore succeeds.
- `new Repl(agent, { continueSession: true })` followed by `start()` hydrates the latest restored session controller when restore succeeds.
- Restored session loop tasks run from the timer without another user input line.
- Failed or absent startup restore does not hydrate controllers.
- Targeted REPL tests pass, followed by `npm run ci:check`.
