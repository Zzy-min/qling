# Plan: MiMo-inspired Tab agents view

1. Add RED TUI tests for empty-input `Tab`, non-empty-input `Tab`, and raw stdin `\t` dispatch.
2. Update `StreamUI` so `Tab` dispatches `/agents` only when the input buffer is empty.
3. Keep non-empty draft safety by showing a local hint and preserving the draft/cursor.
4. Update TUI header and `src/shortcuts.ts` to make the shortcut discoverable.
5. Run targeted build/test, full CI, old-name scan, diff review, and push.

## Risk Notes

- `Tab` is commonly used for completion. Until completion exists, inserting a literal tab into prompts is less useful than a safe local view shortcut.
- Dispatching `/agents` through the existing input callback keeps routing centralized and avoids a second implementation of the agents view.
