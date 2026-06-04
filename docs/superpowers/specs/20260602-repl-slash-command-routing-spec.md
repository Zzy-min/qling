# REPL Slash Command Routing Spec

## Problem

`qingling chat` already routes slash commands through the local command dispatcher, but `qingling repl` still treats `/help`, `/exports`, and other slash commands as normal prompts for the model.

This creates inconsistent interactive behavior and makes the older REPL entrypoint feel less like Claude Code.

## Goals

- Route slash commands typed in `qingling repl` through the existing local slash command dispatcher before model execution.
- Preserve existing REPL commands: `q`, `quit`, `exit`, `!reset`, `!save`, `!load`, `!sessions`, and `!ls`.
- Keep slash command execution local-first, using the existing command implementations and default writers.
- Make REPL single-line input behavior directly unit-testable without driving the readline loop.

## Non-Goals

- Replacing the streaming TUI.
- Changing command output formats.
- Adding new slash commands.
- Changing session file formats.

## Acceptance Criteria

- In REPL input handling, `/help` prints slash help locally and does not call `AgentLoop.addUserMessage()` or `AgentLoop.run()`.
- Existing non-slash prompts still call the model path and checkpoint the session.
- Existing `!sessions` behavior remains available.
- Targeted tests pass, followed by `npm run ci:check`.
