# Slash Self-Correction Spec

## Background

Qling already suggests nearby slash commands for typos, but the message is still a compact error string. For a smoother local agent experience, unknown slash commands should act like a small self-correction panel: identify the typo, show the best correction, show how to inspect usage, and explain how to send the text as a normal prompt instead of a command.

## Goal

Improve unknown slash-command feedback without running tools, reading files, calling a model, or changing command execution.

## User Contract

- When a close slash command exists, the error output includes:
  - the unknown command
  - the suggested command list
  - a primary "可执行" command
  - a focused help command
  - a normal-prompt escape hint for text that was not intended as a command
  - a local-only correction boundary
- When no strong suggestion exists, the fallback still points to `/help`, but also explains how to send normal text.
- Existing command routing remains unchanged.

## Non-Goals

- No automatic execution of suggested commands.
- No model-based correction.
- No command alias migration.
