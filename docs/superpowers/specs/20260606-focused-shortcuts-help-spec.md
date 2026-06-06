# Focused Shortcuts Help Spec

## Goal

Improve local help discoverability by making focused help resolve the TUI shortcut topic consistently across slash and CLI surfaces.

## Requirements

- `/help shortcuts` shows focused help for TUI shortcut usage.
- `/help 快捷键` shows the same focused help topic.
- `/shortcuts --help` and `/快捷键 -h` route to focused help instead of the full shortcut listing.
- `qling help shortcuts` shows focused CLI help for the same topic.
- Focused help remains local-only: static help text only, no model call, no network, no session body reads, no state mutation.
- Existing `/shortcuts` behavior remains unchanged and still prints the full shortcut table.

## Non-Goals

- Do not duplicate the full shortcut table in focused help.
- Do not change TUI shortcut behavior.
- Do not change unrelated help topics or typo thresholds.

## Verification

- Slash unit tests cover English and Chinese focused shortcut help.
- Slash unit tests cover help flags on `/shortcuts` and `/快捷键`.
- CLI smoke tests cover `qling help shortcuts`.
- Full CI, audit, and stale-name scan pass.
