# Checkpoint Overwrite Guard Spec

## Motivation

Local checkpoints are recovery artifacts. Silently overwriting an existing checkpoint name can destroy the user's intended rollback point. Qling should make checkpoint creation conservative by default across both slash and top-level CLI surfaces.

## Requirements

- `qling checkpoint <name>` must refuse to overwrite an existing local session/checkpoint name by default.
- `/checkpoint <name>` must refuse to overwrite an existing saved local session/checkpoint name by default when saved session metadata is available.
- Both surfaces must support `--force` to allow explicit overwrite.
- Refusal output must explain that the checkpoint already exists and mention `--force`.
- Default unnamed checkpoint behavior remains unchanged.
- Existing current-session autosave/checkpoint behavior must not be affected.
- No message bodies are printed.

## Non-Goals

- No change to `SessionRegistry.save()` because internal autosave intentionally overwrites the current session snapshot.
- No deletion or migration of existing checkpoint files.
