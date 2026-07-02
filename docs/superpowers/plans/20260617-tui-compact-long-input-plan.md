# TUI Compact Long Input Plan

## Steps
1. Add draft display metadata to `StreamUI` to distinguish typed and pasted drafts.
2. Detect compact draft mode when the draft contains newlines or wraps beyond one visual row.
3. Render compact drafts as a single summary row while keeping `InputBuffer.value` unchanged.
4. Pin compact-mode cursor placement to the content row and reuse scoped redraw clearing.
5. Reset or restore metadata on submit, clear, history navigation, and Ctrl+Z restore.
6. Add unit tests for pasted summaries, manual draft summaries, full-content submission, cursor placement, and repeated empty Delete redraw scope.

## Verification
- `npm run build`
- `node --test tests\\unit\\input-buffer.test.mjs tests\\unit\\streaming-tui-ctrl-c.test.mjs`
- `npm run ci:check`
- `git diff --check`
