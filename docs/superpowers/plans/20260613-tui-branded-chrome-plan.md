# Plan: TUI branded chrome foundation

1. Add RED tests for `formatTuiHeader()`.
2. Extend existing StreamUI tests to expect the new header on redraw without changing draft behavior.
3. Add shortcut tests for `/help`, `/privacy`, `/context`, `/statusline`, and `Tab agents` discoverability.
4. Implement a pure `src/tui/chrome.ts` formatter and wire `StreamUI.printHeader()` to it.
5. Update `src/shortcuts.ts` static lines only.
6. Verify with targeted tests, full CI, old-name scan, diff checks, npm audit, staged checks, commit, and push.
