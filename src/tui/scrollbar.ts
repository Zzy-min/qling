// Scrollbar geometry for the fullscreen scrollback rail.
// A 1-column rail on the right. The handle stays a short ┃ mark, with no
// filled track. Click-to-jump centers that handle on the click. While the
// viewport is away from the bottom, new output keeps the same lines in view.

export interface ScrollbarThumb {
  start: number;
  length: number;
}

export type ScrollbarClick =
  | { kind: "top" }
  | { kind: "bottom" }
  | { kind: "offset"; offsetFromTop: number };

export function needsScrollbar(totalLines: number, viewportLines: number): boolean {
  return totalLines > viewportLines && viewportLines > 0;
}

/** Keep the handle a short slider. A viewport-sized thumb fills the rail. */
const MAX_THUMB_CELLS = 2;

/** Thumb range inside a vertical track. `offsetFromTop` is 0 at the top. */
export function scrollbarThumb(
  trackCells: number,
  totalLines: number,
  viewportLines: number,
  offsetFromTop: number,
): ScrollbarThumb | null {
  if (trackCells <= 0 || !needsScrollbar(totalLines, viewportLines)) return null;
  const proportional = Math.round((trackCells * viewportLines) / totalLines);
  const thumbLen = Math.max(1, Math.min(trackCells, MAX_THUMB_CELLS, proportional));
  const maxStart = trackCells - thumbLen;
  const span = totalLines - viewportLines;
  const clamped = Math.max(0, Math.min(span, offsetFromTop));
  const start = span === 0 || maxStart === 0 ? 0 : Math.round((clamped / span) * maxStart);
  return { start, length: thumbLen };
}

/**
 * Inverse of the thumb. The first track row jumps to the top, the last row
 * jumps to the bottom, and a middle click centers the thumb on that cell.
 */
export function scrollbarClickToOffset(
  cellIndex: number,
  trackCells: number,
  totalLines: number,
  viewportLines: number,
): ScrollbarClick {
  if (trackCells <= 0) return { kind: "top" };
  if (cellIndex <= 0) return { kind: "top" };
  if (cellIndex >= trackCells - 1) return { kind: "bottom" };
  const span = Math.max(0, totalLines - viewportLines);
  const probe = scrollbarThumb(trackCells, totalLines, viewportLines, 0);
  const thumbLen = probe?.length ?? 1;
  const maxStart = Math.max(0, trackCells - thumbLen);
  if (maxStart === 0 || span === 0) return { kind: "top" };
  const desiredStart = Math.max(0, Math.min(maxStart, cellIndex - Math.floor(thumbLen / 2)));
  return {
    kind: "offset",
    offsetFromTop: Math.round((desiredStart / maxStart) * span),
  };
}

/** Map qling's bottom-anchored scroll offset onto a top-anchored content offset. */
export function scrollOffsetToContentOffset(
  scrollOffset: number,
  maxScrollOffset: number,
  totalLines: number,
  viewportLines: number,
): number {
  const span = Math.max(0, totalLines - viewportLines);
  if (maxScrollOffset <= 0) return span;
  const clamped = Math.max(0, Math.min(maxScrollOffset, scrollOffset));
  return Math.round((1 - clamped / maxScrollOffset) * span);
}

/** Inverse of `scrollOffsetToContentOffset`. */
export function contentOffsetToScrollOffset(
  contentOffset: number,
  maxScrollOffset: number,
  totalLines: number,
  viewportLines: number,
): number {
  const span = Math.max(0, totalLines - viewportLines);
  if (span <= 0 || maxScrollOffset <= 0) return 0;
  const clamped = Math.max(0, Math.min(span, contentOffset));
  return Math.round((1 - clamped / span) * maxScrollOffset);
}
