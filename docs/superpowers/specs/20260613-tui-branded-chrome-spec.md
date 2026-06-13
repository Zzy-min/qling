# Spec: TUI branded chrome foundation

## Background

Qling already has a StreamUI with colors, statusline, slash commands, and local input safeguards. The active product goal asks for a dedicated UI surface. The current TUI header is still hard-coded inside `StreamUI.printHeader()` and does not clearly frame the product as local-first and slash-first.

## Goal

Create a small reusable TUI chrome formatter and apply it to the startup/redraw header. Keep the existing input behavior, color palette, statusline, and slash command semantics unchanged.

## Requirements

- Add a pure `formatTuiHeader(options)` formatter with `model`, `tools`, and `cwd`.
- The header must include:
  - `轻灵 · Agent CLI`
  - `model=<model>  tools=<count>  mode=local-first`
  - `workspace=<cwd>`
  - `/help slash · Tab agents · Ctrl+Z restore · Ctrl+O output · /privacy boundary`
- `StreamUI.printHeader()` must use the formatter instead of hard-coding the header text.
- `/shortcuts` must surface the local UI entrypoints `/help`, `/privacy`, `/context`, `/statusline`, and `Tab agents`.
- Do not change constructor signatures, slash command APIs, statusline APIs, storage formats, model calls, or shortcut behavior.

## Acceptance

- Formatter tests cover title, model, tools, workspace, local-first, slash-first, and privacy boundary text.
- Existing TUI redraw tests prove the new header appears and draft preservation still works.
- Shortcut tests prove the local UI entrypoints are discoverable.
