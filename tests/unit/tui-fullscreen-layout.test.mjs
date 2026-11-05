import test from "node:test";
import assert from "node:assert/strict";

import {
  computeFullscreenLayout,
  fullscreenRectBottom,
  validateFullscreenLayout,
} from "../../dist/tui/fullscreen-layout.js";

const widths = [1, 10, 39, 40, 41, 60, 79, 80, 81, 96, 100, 119, 120, 121, 139, 140, 160, 200, 240];
const heights = [1, 4, 7, 8, 9, 12, 16, 23, 24, 30, 50, 60];
const inputRows = [1, 2, 4, 8, 12, 50];

test("fullscreen layout is a single non-overlapping allocation for every size", () => {
  for (const width of widths) {
    for (const height of heights) {
      for (const desired of inputRows) {
        const layout = computeFullscreenLayout(width, height, desired);
        assert.equal(layout.width, width);
        assert.equal(layout.height, height);
        assert.equal(layout.degraded, width < 40 || height < 8);
        assert.deepEqual(
          validateFullscreenLayout(layout),
          [],
          `${width}x${height} input=${desired}`
        );
        if (layout.degraded) continue;
        assert.equal(layout.header.y, 0);
        assert.equal(layout.body.y, fullscreenRectBottom(layout.header));
        assert.equal(layout.input.y, fullscreenRectBottom(layout.body));
        assert.equal(layout.footer.y, fullscreenRectBottom(layout.input));
        assert.equal(fullscreenRectBottom(layout.footer), height);
        assert.ok(layout.body.height >= 1);
        assert.ok(layout.input.height >= 3);
        assert.ok(layout.inputContentRows <= 8);
      }
    }
  }
});

test("input growth consumes body rows before it can push chrome off-screen", () => {
  const small = computeFullscreenLayout(80, 8, 50);
  const large = computeFullscreenLayout(80, 24, 50);
  assert.equal(small.body.height, 1);
  assert.equal(small.inputContentRows, 2);
  assert.equal(fullscreenRectBottom(small.footer), 8);
  assert.ok(large.body.height > small.body.height);
  assert.equal(large.inputContentRows, 8);
  assert.equal(fullscreenRectBottom(large.footer), 24);
});

test("invalid terminal measurements never inflate the requested viewport", () => {
  const empty = computeFullscreenLayout(Number.NaN, Number.NaN, 1);
  assert.equal(empty.width, 0);
  assert.equal(empty.height, 0);
  assert.equal(empty.degraded, true);

  const negative = computeFullscreenLayout(-10, -2, 1);
  assert.equal(negative.width, 0);
  assert.equal(negative.height, 0);
  assert.equal(negative.degraded, true);
});