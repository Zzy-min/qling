# REPL Local Loop Goal Context Spec

## Problem

`qingling repl` can now route slash commands, but it still lacks the local scheduler and goal controller context that the streaming TUI provides. Commands such as `/loop`, `/tasks`, and `/goal` therefore report "not enabled" or cannot persist local control state from the classic REPL.

This leaves two interactive surfaces with different capabilities and weakens the Claude Code-like operator-console experience.

## Goals

- Enable classic REPL slash commands to use a local `SessionScheduler`.
- Enable classic REPL slash commands to use a local `SessionGoalController`.
- Keep initialization lazy so REPL startup and ordinary prompts do not require extra state setup unless local control commands are used.
- Keep all loop/task/goal data in the existing local runtime directories.
- Preserve ordinary prompt behavior and legacy `!` commands.

## Non-Goals

- Changing streaming TUI behavior.
- Adding daemon-backed loop/goal behavior to classic REPL.
- Changing slash command output formats.
- Changing task or goal persistence formats.

## Acceptance Criteria

- `/loop 1m <prompt>` in REPL creates a local session task and does not call the model path.
- `/tasks` in REPL lists the locally created task.
- `/goal <condition>` in REPL persists a local session goal, requests immediate processing through the existing goal prompt mechanism, and does not treat the slash command itself as a model prompt.
- Existing `/sessions`, `/resume`, legacy `!sessions`, and ordinary prompt tests remain green.
- Targeted tests pass, followed by `npm run ci:check`.
