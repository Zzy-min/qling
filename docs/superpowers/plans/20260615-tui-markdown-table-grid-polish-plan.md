# TUI Markdown Table Grid Polish Plan

## Steps

1. Add RED tests for stock-style Markdown table output:
   - no literal `**` in rendered table cells;
   - row separators appear between body rows;
   - ANSI-stripped line widths remain aligned.
2. Update `src/tui/markdown.ts` table rendering:
   - normalize inline Markdown markers before measuring and drawing cells;
   - render borders with dim gray styling instead of primary green;
   - render header cells in bold bright text and body cells in bright text;
   - insert body separators between rows.
3. Run targeted Markdown tests.
4. Run build, full CI, legacy-name scan, diff check, and audit.

## Verification

- `npm run build && node --test tests\unit\tui-markdown.test.mjs`
- `npm run ci:check`
- `rg -n "q[i]ngling|Q[i]ngling|Q[I]NGLING" . -g "!node_modules/**" -g "!dist/**" -g "!.git/**"`
- `git diff --check`
- `npm audit --registry=https://registry.npmjs.org --audit-level=high`
