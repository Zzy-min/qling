# Memory Context Sources Spec

## Background

MiMo-Code treats long-running coding context as a set of explicit sources: project memory, checkpoints, notes, and task progress. qling already has local memory list/search/graph/practices, but users cannot quickly see which local stores may contribute to context recovery and which stores are audit-only.

## Goal

Add a read-only memory source map so users can inspect local context-memory boundaries without reading session bodies or calling a model.

## User Contract

- `/memory sources` and `/记忆 来源` show the local state directory and source categories.
- `qling memory sources` uses the same report.
- The report lists:
  - persisted memory file
  - cognitive index database
  - session checkpoint directory
  - goal/task state directory
- The report states whether each path exists and whether it is used for context recall, audit, or resume metadata.
- The report must not read session bodies, call a model, or use the network.

## Non-Goals

- No automatic context injection changes.
- No migration of existing memory files.
- No remote or cloud sync.
