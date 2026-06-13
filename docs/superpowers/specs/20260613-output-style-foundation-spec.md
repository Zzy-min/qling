# Spec: Output style foundation for local reports

## Background

The active product goal asks for a dedicated UI feel and better output standards. Qling already has local reports such as `/context`, but each report hand-rolls titles, separators, and key-value rows. This makes output harder to keep consistent as slash commands grow.

## Goal

Introduce a small reusable local output-style formatter and apply it to `/context` first, preserving current data semantics while making the report more structured and easier to scan.

## Requirements

- Add a reusable formatter for local report panels with:
  - a branded title line,
  - named sections,
  - aligned key-value rows,
  - a final local/privacy boundary note.
- `/context` output uses the formatter and keeps all existing facts:
  - session id, turn count, message count,
  - token usage, token source, token explanation,
  - context status and recommendation,
  - compaction count, local paths, saved session count, latest save time.
- The formatter must not read files, call models, access network, or mutate local state.
- Output remains plain terminal text and compatible with existing tests.

## Non-goals

- Do not redesign every report in this change.
- Do not add rich terminal dependencies.
- Do not change token accounting or context calculations.

## Acceptance

- Unit tests cover the shared formatter.
- Context report tests prove the new output includes the branded title, sections, aligned rows, recommendation, and local-only boundary.
- Targeted build and tests pass.
