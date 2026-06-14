# Plan: Claude-style slash command interaction

1. Add RED tests for Claude-compatible catalog entries, unavailable command behavior, local high-frequency commands, direct skill invocation, and TUI slash panel selection.
2. Extend slash command metadata while preserving `SlashCommand.execute(args, context)`.
3. Add local command modules for `/usage`, `/model`, `/plan`, `/diff`, `/copy`, `/init`, `/rewind`, and unavailable cloud/platform command shells.
4. Route unknown slash names through direct local skill lookup before typo correction.
5. Upgrade TUI completion formatting to a multi-line categorized panel with selected candidate state and argument hints.
6. Verify with targeted tests, full CI, old-name scan, whitespace check, and npm audit.

## Verification
- `npm run build && node --test tests\\unit\\slash-commands.test.mjs tests\\unit\\help-topics.test.mjs tests\\unit\\streaming-tui-ctrl-c.test.mjs tests\\unit\\skill.test.mjs`
- `npm run ci:check`
- old-name scan for removed legacy project names, excluding `node_modules`, `dist`, and `.git`
- `git diff --check`
- `npm audit --registry=https://registry.npmjs.org --audit-level=high`
