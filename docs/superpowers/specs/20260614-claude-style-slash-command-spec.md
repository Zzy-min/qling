# Spec: Claude-style slash command interaction

## Summary
Qling should provide a Claude Code style slash-first command surface: typing `/` shows a filtered command panel, commands are recognized only at the start of input, arguments remain plain command text, and local skills can be invoked directly as slash entries.

## Goals
- Keep slash commands local-first and deterministic.
- Expose a broad Claude-compatible command shell without pretending cloud/account-only features work locally.
- Use one slash catalog for help, correction, completion, focused help, and unavailable command explanations.
- Support direct local skill invocation as `/<skill-name>` while preserving built-in command priority.
- Upgrade the TUI slash panel with command categories, argument hints, and selectable candidates.

## Acceptance Criteria
- Built-in local commands include `/usage`, `/model`, `/plan`, `/diff`, `/copy`, `/init`, and `/rewind`.
- Alias coverage includes `/new`, `/cost`, `/stats`, `/allowed-tools`, `/settings`, `/undo`, and `/bg`.
- Cloud/account/platform commands are discoverable but execute to a local boundary message only.
- `/model <name>` changes only the current process session model and refreshes TUI status/header.
- `/plan <description>` queues a normal planning prompt through the existing prompt path.
- `/diff` is read-only and reports Git state; non-Git workspaces get a clear local message.
- `/copy [N]` copies the Nth latest assistant reply when available.
- `/init` creates a local project guide only when safe; existing files are not overwritten without `--force`.
- `/<local-skill>` loads the matching local skill; built-ins win on name conflicts.
- TUI slash completion shows up to eight candidates and supports `Up`/`Down` selection plus `Tab` acceptance.

## Non-goals
- No Anthropic account login, Claude Desktop handoff, mobile QR, cloud workflow, GitHub App installation, or remote control implementation.
- No full-screen alternate TUI and no new runtime dependency.
- No session/memory/token storage format changes.
