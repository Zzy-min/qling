# Focused Shortcuts Help Plan

## Steps

1. Add a `shortcuts` topic to `src/help-topics.ts` with English and Chinese aliases.
2. Keep the topic boundary explicitly local-only and point examples to `/shortcuts`, `/快捷键`, and CLI equivalents.
3. Add slash unit tests for `/help shortcuts`, `/help 快捷键`, `/shortcuts --help`, and `/快捷键 -h`.
4. Add CLI smoke coverage for `qling help shortcuts`.
5. Run targeted tests, full CI, audit, stale-name scan, then commit and push.

## Risks

- Focused help should not become a second full shortcut source. Keep detailed key table centralized in `src/shortcuts.ts`.
- Help flag behavior must not affect direct `/shortcuts` listing without flags.
