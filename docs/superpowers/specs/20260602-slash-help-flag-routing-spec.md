# Slash Help Flag Routing Spec

## Problem

Slash commands currently dispatch directly to the matched command implementation. When a user types `/exports --help` or `/导出列表 -h`, the command receives the help flag as a normal argument and may execute local behavior instead of showing focused help.

This is inconsistent with the top-level CLI help flag behavior and makes the TUI less predictable.

## Goals

- Treat `--help` and `-h` on slash commands as a request for focused local help.
- Keep `/help <topic>` and `/? <topic>` behavior unchanged.
- Preserve unknown slash command typo suggestions when no help flag is present.
- For unknown slash commands with a help flag, show focused help for the typed topic so typo suggestions can be surfaced through the help system.
- Keep all behavior local-first and non-destructive.

## Non-Goals

- Changing command implementations or their business behavior.
- Adding new help topics.
- Reworking slash command parsing beyond help flag routing.

## Acceptance Criteria

- `/exports --help` prints focused help for `exports` and does not list local export files.
- `/导出列表 -h` prints focused help for `exports`.
- `/expors --help` prints focused help typo guidance instead of an unknown command error.
- Existing `/expors` without a help flag still reports an unknown command with suggestions.
- `npm run ci:check` passes after implementation.
