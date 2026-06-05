# Shortcut Help Consistency Spec

## Goal

Keep qling's shortcut help aligned with the actual TUI input behavior so users can discover local editing controls without reading source code.

## Scope

- Update `/shortcuts` and `qling shortcuts` output to include:
  - `Ctrl+A` / `Ctrl+E`
  - `Ctrl+U` / `Ctrl+K`
  - `Ctrl+W`
  - `Ctrl+D`
  - `Home` / `End`
  - double `Ctrl+C` exit behavior
- Preserve the local-first boundary statement.
- Keep queue command descriptions in the same help output.

## Non-Goals

- No runtime shortcut behavior changes.
- No model calls, network calls, or persistent state writes.

## Acceptance Criteria

- Slash command tests prove `/shortcuts` includes all supported terminal editing shortcuts.
- CLI smoke tests prove the Chinese alias prints the same current shortcut family.
- The help output no longer claims `Ctrl+C` only clears input.
- Existing shortcut and CLI help tests keep passing.
