# TUI Markdown Table Grid Polish Spec

## Problem

Markdown tables currently render as a compact green box. In stock quote style answers this looks noisy and unfinished:

- inline Markdown markers such as `**最新价**` remain visible inside cells;
- table borders use the primary accent color, making the table compete with content;
- body rows have no horizontal separators, so dense financial data is harder to scan.

## Requirements

- Render Markdown tables closer to a terminal data grid:
  - dim gray borders;
  - bright table content;
  - bold headers;
  - horizontal separators between body rows;
  - no literal `**` or backtick markers in rendered cells.
- Preserve Chinese and mixed-width alignment with `string-width`.
- Preserve invalid pipe-log degradation: non-table pipe text must not be converted into a table.
- Do not add dependencies or change `StreamUI.appendFinal()` public behavior.

## Acceptance Criteria

- A table containing `**最新价**` renders `最新价` without literal Markdown markers.
- Rendered table lines have stable visual width after ANSI stripping.
- Body rows include horizontal separators like `├──┼──┤`, producing a grid closer to the reference screenshot.
- Existing Markdown parser and invalid-table tests continue to pass.
