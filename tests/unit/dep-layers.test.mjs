import test from "node:test";
import assert from "node:assert/strict";
import { layerOf } from "../../scripts/dep-layers.mjs";

test("dashboard-web is classified as presentation", () => {
  assert.equal(layerOf("dashboard-web/App.tsx"), "presentation");
  assert.equal(layerOf("dashboard-web/model.ts"), "presentation");
  assert.equal(layerOf("tui/fullscreen.ts"), "presentation");
});
