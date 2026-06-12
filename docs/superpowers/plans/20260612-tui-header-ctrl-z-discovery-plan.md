# Plan: Surface Ctrl+Z draft restore in TUI header

1. Add a RED assertion to the TUI clear-screen/header test requiring `Ctrl+Z` to appear after header redraw.
2. Update `StreamUI.printHeader()` line 3 to include a compact `Ctrl+Z 恢复` hint.
3. Run targeted build + TUI tests, then full CI, old-name scan, diff check, and npm audit.
4. Commit and push to `origin/main`.

## Risk controls

- Keep this as a discoverability-only change.
- Do not modify input handling or stored state.
- Keep `/shortcuts` as the detailed behavior description.
