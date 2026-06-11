# Session Checkpoint Command Spec

## Motivation

MiMo-Code highlights automatic checkpoints and context reconstruction as core reliability primitives. Qling already saves sessions internally, but users do not have a direct slash command to force a named local recovery point before risky or long-running work.

## Requirements

- Add `/checkpoint [name]` with Chinese alias `/检查点`.
- The command saves the current session snapshot locally via the existing session save API.
- When a name is provided, use it as the local snapshot name; otherwise use the current default session checkpoint behavior.
- Output must show a clear success block with the saved target/path and current session stats when available.
- The command must not call the model, upload data, or read unrelated session bodies.
- If the active agent loop does not support checkpointing, print a user-facing error.
- `/help` and focused help must mention the command and its local-only boundary.

## Non-Goals

- No automatic checkpoint cadence changes.
- No session body rendering.
- No daemon integration in this change.
