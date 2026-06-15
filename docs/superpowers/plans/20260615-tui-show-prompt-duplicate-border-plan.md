# TUI showPrompt Duplicate Border Regression Plan

## Steps

1. Add a unit test that calls `showPrompt()` in running mode and asserts only one input frame top border is emitted for that prompt render.
2. Run the targeted test to confirm the current duplicate-border behavior fails.
3. Remove the redundant `inputFrameTop()` write from `showPrompt()` so `writeInputValue()` is the only frame renderer.
4. Run targeted TUI tests and the full CI check.
5. Run formatting, legacy-name scan, and audit checks before committing.

## Verification

- `npm run build && node --test tests\unit\streaming-tui-ctrl-c.test.mjs tests\unit\tui-shell.test.mjs`
- `npm run ci:check`
- `rg -n "q[i]ngling|Q[i]ngling|Q[I]NGLING" . -g "!node_modules/**" -g "!dist/**" -g "!.git/**"`
- `git diff --check`
- `npm audit --registry=https://registry.npmjs.org --audit-level=high`
