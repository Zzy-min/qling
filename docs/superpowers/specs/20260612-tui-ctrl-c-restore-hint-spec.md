# Spec: Show Ctrl+Z restore hint after Ctrl+C clears a draft

Qling TUI can restore a draft cleared by non-empty `Ctrl+C` via `Ctrl+Z`, and the header advertises it. The exact moment of accidental clearing is still under-explained: the local feedback only prints `^C`, so users may not know recovery is available.

## Requirements

- When non-empty `Ctrl+C` clears the current input buffer, the feedback must mention that `Ctrl+Z` restores the cleared draft.
- The feedback must remain local-only: no input submission, no history write, no model call, no persistence.
- Empty-input `Ctrl+C` double-confirm exit behavior remains unchanged.
- Existing `Ctrl+Z` restore behavior remains unchanged.

## Non-goals

- Do not change `Ctrl+C` key semantics.
- Do not add persistent undo state.
- Do not modify slash command behavior.

## Verification

- TUI unit tests assert non-empty `Ctrl+C` output includes `Ctrl+Z` and restore wording.
- Targeted TUI tests and full CI pass before push.
