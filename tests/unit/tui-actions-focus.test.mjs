import test from "node:test";
import assert from "node:assert/strict";

import {
  lookupAction,
  captureJumpRestore,
  DEFAULT_ACTIONS,
} from "../../dist/tui/actions.js";
import {
  tabStructuralFocus,
  canEditPrompt,
  spaceFocusPrompt,
} from "../../dist/tui/focus-model.js";

test("action registry maps Ctrl+\\ and turn keys", () => {
  assert.equal(
    lookupAction("\x1c", { focus: "prompt", overlayOpen: false, inputEmpty: true }),
    "open_session_picker"
  );
  assert.equal(
    lookupAction("\x1b[5~", { focus: "prompt", overlayOpen: false, inputEmpty: true }),
    "turn_prev"
  );
  assert.equal(
    lookupAction("\x1b[5~", { focus: "scrollback", overlayOpen: true, inputEmpty: true }),
    "viewport_page_up"
  );
  assert.equal(
    lookupAction("\t", { focus: "prompt", overlayOpen: false, inputEmpty: true }),
    "focus_scrollback"
  );
  assert.equal(
    lookupAction("\t", { focus: "prompt", overlayOpen: false, inputEmpty: false }),
    null
  );
  assert.ok(DEFAULT_ACTIONS.length >= 8);
});

test("focus model tab and space semantics mirror Grok panes", () => {
  assert.equal(
    tabStructuralFocus({ focus: "prompt", overlay: "none" }, true),
    "scrollback"
  );
  assert.equal(
    tabStructuralFocus({ focus: "scrollback", overlay: "turns" }, true),
    "prompt"
  );
  assert.equal(
    tabStructuralFocus({ focus: "prompt", overlay: "none" }, false),
    null
  );
  assert.equal(canEditPrompt({ focus: "prompt", overlay: "none" }), true);
  assert.equal(canEditPrompt({ focus: "prompt", overlay: "sessions" }), false);
  assert.equal(spaceFocusPrompt({ focus: "scrollback", overlay: "turns" }), true);
});

test("jump restore snapshot", () => {
  const r = captureJumpRestore("scrollback", 3);
  assert.deepEqual(r, { focus: "scrollback", turnSelected: 3 });
});
