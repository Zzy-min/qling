# Plan: Show Ctrl+Z restore hint after Ctrl+C clears a draft

1. Add a RED assertion to the non-empty `Ctrl+C` TUI test requiring `Ctrl+Z` recovery wording.
2. Update `StreamUI.handleCtrlC()` non-empty branch to print a compact local hint after `^C`.
3. Run targeted TUI tests, full CI, old-name scan, diff check, and npm audit.
4. Commit and push to `origin/main`.

## Risk controls

- Do not change submitted input or history semantics.
- Keep empty-input `Ctrl+C` exit confirmation untouched.
- Keep the hint concise so it does not disrupt the prompt layout.
