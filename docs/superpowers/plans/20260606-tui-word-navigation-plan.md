# TUI Word Navigation Shortcut Plan

## Steps

1. Add `InputBuffer.moveWordLeft()` and `InputBuffer.moveWordRight()` with whitespace-aware boundaries.
2. Add StreamUI handlers for word-left and word-right that only move the cursor and resync display.
3. Extend raw input parsing to support:
   - `Alt+B` / `Alt+F`
   - `Alt+Left` / `Alt+Right`
   - `Ctrl+Left` / `Ctrl+Right` common CSI sequences
4. Update startup shortcut hints and `/shortcuts` help.
5. Add unit and smoke coverage, then run repository gates.

## Risks

- Escape sequence parsing can regress existing bracketed paste and Home/End support. Keep existing exact sequence handling and only broaden CSI accumulation for semicolon modifier forms.
- Terminal sequence variants differ. Support common variants without adding ambiguous behavior for unknown escape sequences.
