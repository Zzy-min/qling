# Spec: Surface Ctrl+Z draft restore in TUI header

Qling now supports restoring a draft cleared by non-empty `Ctrl+C` via `Ctrl+Z`, but the startup header only advertises common editing shortcuts and `Ctrl+D` exit. Users may not discover the recovery path when they need it most. The TUI header should expose the local recovery shortcut alongside other high-value keys.

## Requirements

- The TUI startup header must mention `Ctrl+Z` and its draft restore behavior.
- The header printed after `Ctrl+L` redraw must include the same `Ctrl+Z` hint.
- The hint must remain local-only: no model call, no persistence, no history write.
- `/shortcuts` remains the detailed source of truth.

## Non-goals

- Do not redesign the header layout.
- Do not change `Ctrl+Z` behavior.
- Do not add new shortcuts.

## Verification

- Existing TUI header/clear-screen test asserts the header includes `Ctrl+Z`.
- Targeted TUI tests and full CI pass before push.
