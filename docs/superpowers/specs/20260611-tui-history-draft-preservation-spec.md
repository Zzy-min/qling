# TUI History Draft Preservation Spec

## Goal

Make TUI history navigation safer and smoother by preserving the user's current unsent draft while browsing previous prompts.

## Requirements

- Pressing history up from the live input position saves the current input value and cursor position as a local draft.
- Pressing history down back past the newest history entry restores the saved draft instead of clearing input.
- Draft preservation works for multiline input.
- Draft preservation works when `Ctrl+R` jumps to a matching history entry.
- Submitting or clearing input resets the saved draft.
- The behavior remains local-only and does not persist the draft to disk.
- Shortcut help documents that `↑ / ↓` restores the unsent draft when returning to the bottom.

## Non-Goals

- Do not change persisted history storage.
- Do not upload, export, or log the draft.
- Do not add fuzzy history search or reverse incremental search UI.

## Verification

- Unit tests cover up/down draft restoration.
- Unit tests cover multiline drafts and cursor restoration.
- Unit tests cover `Ctrl+R` history search preserving the draft when navigating back down.
- Shortcut help tests cover the updated `↑ / ↓` description.
- Full CI, audit, and stale-name scan pass.
