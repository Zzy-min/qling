/**
 * Pure layout model for the fullscreen TUI.
 *
 * Grok Build's `views/agent.rs::AgentViewLayout` separates layout computation
 * from rendering and never expands the requested terminal area. This module
 * applies the same rule to qling: every region is derived from the actual
 * terminal size, fixed chrome is reserved before the scrollback, and the
 * result is validated by a single invariant boundary.
 */

export const FULLSCREEN_MIN_COLUMNS = 40;
export const FULLSCREEN_MIN_ROWS = 8;
export const FULLSCREEN_HEADER_ROWS = 2;
export const FULLSCREEN_FOOTER_ROWS = 1;
export const FULLSCREEN_INPUT_BORDER_ROWS = 2;
export const FULLSCREEN_MAX_INPUT_ROWS = 8;

export interface TuiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FullscreenLayout {
  width: number;
  height: number;
  degraded: boolean;
  header: TuiRect;
  body: TuiRect;
  input: TuiRect;
  footer: TuiRect;
  /** Number of editable text rows inside the input border. */
  inputContentRows: number;
}

export function fullscreenRectBottom(rect: TuiRect): number {
  return rect.y + rect.height;
}

function finiteFloor(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function rect(x: number, y: number, width: number, height: number): TuiRect {
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
}

/**
 * Allocate the screen exactly once. The body absorbs the remaining rows after
 * header, input, and footer are reserved; input growth may shrink the body but
 * can never push the footer or cursor outside the terminal.
 */
export function computeFullscreenLayout(
  columns: number,
  rows: number,
  desiredInputRows = 1
): FullscreenLayout {
  const width = finiteFloor(columns, 0);
  const height = finiteFloor(rows, 0);
  const degraded =
    width < FULLSCREEN_MIN_COLUMNS || height < FULLSCREEN_MIN_ROWS;

  if (degraded) {
    return {
      width,
      height,
      degraded: true,
      header: rect(0, 0, width, height),
      body: rect(0, 0, width, 0),
      input: rect(0, height, width, 0),
      footer: rect(0, height, width, 0),
      inputContentRows: 0,
    };
  }

  const minBodyRows = height >= 12 ? 4 : 1;
  const maxInputContent = Math.max(
    1,
    Math.min(
      FULLSCREEN_MAX_INPUT_ROWS,
      height -
        FULLSCREEN_HEADER_ROWS -
        FULLSCREEN_FOOTER_ROWS -
        FULLSCREEN_INPUT_BORDER_ROWS -
        minBodyRows
    )
  );
  const inputContentRows = Math.max(
    1,
    Math.min(finiteFloor(desiredInputRows, 1) || 1, maxInputContent)
  );
  const inputHeight = inputContentRows + FULLSCREEN_INPUT_BORDER_ROWS;
  const inputY = height - FULLSCREEN_FOOTER_ROWS - inputHeight;
  const bodyHeight = inputY - FULLSCREEN_HEADER_ROWS;

  return {
    width,
    height,
    degraded: false,
    header: rect(0, 0, width, FULLSCREEN_HEADER_ROWS),
    body: rect(0, FULLSCREEN_HEADER_ROWS, width, bodyHeight),
    input: rect(0, inputY, width, inputHeight),
    footer: rect(0, height - FULLSCREEN_FOOTER_ROWS, width, FULLSCREEN_FOOTER_ROWS),
    inputContentRows,
  };
}

/** Test-friendly structural check shared by every layout consumer. */
export function validateFullscreenLayout(layout: FullscreenLayout): string[] {
  const errors: string[] = [];
  const { width, height, header, body, input, footer } = layout;
  if (layout.degraded) return errors;
  if (header.y !== 0 || header.height !== FULLSCREEN_HEADER_ROWS) {
    errors.push("header must occupy the first two rows");
  }
  if (body.y !== fullscreenRectBottom(header)) {
    errors.push("body must start directly after the header");
  }
  if (input.y !== fullscreenRectBottom(body)) {
    errors.push("input must start directly after the body");
  }
  if (footer.y !== fullscreenRectBottom(input)) {
    errors.push("footer must start directly after the input");
  }
  if (fullscreenRectBottom(footer) !== height) {
    errors.push("footer must end at the terminal bottom");
  }
  if (body.height < 1) errors.push("body must retain at least one row");
  if (input.height < FULLSCREEN_INPUT_BORDER_ROWS + 1) {
    errors.push("input must retain its borders and one editable row");
  }
  if ([header, body, input, footer].some((item) => item.width !== width)) {
    errors.push("every region must use the actual terminal width");
  }
  return errors;
}