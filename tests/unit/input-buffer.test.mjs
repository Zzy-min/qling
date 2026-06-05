import test from "node:test";
import assert from "node:assert/strict";

import { InputBuffer } from "../../dist/tui/input-buffer.js";

test("input buffer inserts characters and submits trimmed command", () => {
  const buffer = new InputBuffer();
  buffer.insertChar("h");
  buffer.insertChar("i");

  assert.equal(buffer.value, "hi");
  assert.equal(buffer.cursorPos, 2);
  assert.equal(buffer.submit(), "hi");
  assert.equal(buffer.value, "");
});

test("input buffer inserts newline without submitting", () => {
  const buffer = new InputBuffer();
  buffer.insertChar("a");
  buffer.insertNewline();
  buffer.insertChar("b");

  assert.equal(buffer.value, "a\nb");
  assert.equal(buffer.cursorPos, 3);
  assert.equal(buffer.submit(), "a\nb");
});

test("input buffer edits around cursor across lines", () => {
  const buffer = new InputBuffer();
  for (const ch of "ab") buffer.insertChar(ch);
  buffer.insertNewline();
  for (const ch of "cd") buffer.insertChar(ch);
  buffer.moveLeft();
  buffer.insertChar("X");

  assert.equal(buffer.value, "ab\ncXd");
  buffer.backspace();
  assert.equal(buffer.value, "ab\ncd");
});

test("input buffer can delete newline with backspace", () => {
  const buffer = new InputBuffer();
  buffer.insertChar("a");
  buffer.insertNewline();
  buffer.insertChar("b");
  buffer.moveLeft();
  buffer.backspace();

  assert.equal(buffer.value, "ab");
});

test("input buffer history restores multiline entries", () => {
  const buffer = new InputBuffer();
  buffer.insertChar("a");
  buffer.insertNewline();
  buffer.insertChar("b");
  assert.equal(buffer.submit(), "a\nb");

  buffer.historyUp();
  assert.equal(buffer.value, "a\nb");
  buffer.historyDown();
  assert.equal(buffer.value, "");
});

test("input buffer searches most recent matching history entry", () => {
  const buffer = new InputBuffer();
  for (const ch of "npm run build") buffer.insertChar(ch);
  assert.equal(buffer.submit(), "npm run build");
  for (const ch of "npm test") buffer.insertChar(ch);
  assert.equal(buffer.submit(), "npm test");
  for (const ch of "npm run ci:check") buffer.insertChar(ch);
  assert.equal(buffer.submit(), "npm run ci:check");

  for (const ch of "run") buffer.insertChar(ch);
  assert.equal(buffer.searchHistory(), true);
  assert.equal(buffer.value, "npm run ci:check");
  assert.equal(buffer.cursorPos, "npm run ci:check".length);
});

test("input buffer can preload persisted history for navigation and search", () => {
  const buffer = new InputBuffer();
  buffer.setHistory(["npm run build", "npm test", "npm run ci:check"]);

  buffer.historyUp();
  assert.equal(buffer.value, "npm run ci:check");

  buffer.clear();
  for (const ch of "build") buffer.insertChar(ch);
  assert.equal(buffer.searchHistory(), true);
  assert.equal(buffer.value, "npm run build");
  assert.equal(buffer.cursorPos, "npm run build".length);
});

test("input buffer search with empty query restores latest history", () => {
  const buffer = new InputBuffer();
  for (const ch of "first") buffer.insertChar(ch);
  assert.equal(buffer.submit(), "first");
  for (const ch of "second") buffer.insertChar(ch);
  assert.equal(buffer.submit(), "second");

  assert.equal(buffer.searchHistory(), true);
  assert.equal(buffer.value, "second");
});

test("input buffer search miss keeps current input", () => {
  const buffer = new InputBuffer();
  for (const ch of "npm run build") buffer.insertChar(ch);
  assert.equal(buffer.submit(), "npm run build");

  for (const ch of "deploy") buffer.insertChar(ch);
  assert.equal(buffer.searchHistory(), false);
  assert.equal(buffer.value, "deploy");
  assert.equal(buffer.cursorPos, "deploy".length);
});

test("input buffer moves to start and end of current input", () => {
  const buffer = new InputBuffer();
  for (const ch of "abc") buffer.insertChar(ch);
  buffer.moveLeft();

  buffer.moveStart();
  assert.equal(buffer.cursorPos, 0);

  buffer.moveEnd();
  assert.equal(buffer.cursorPos, 3);
});

test("input buffer deletes content before and after cursor", () => {
  const buffer = new InputBuffer();
  for (const ch of "abcdef") buffer.insertChar(ch);
  buffer.moveLeft();
  buffer.moveLeft();

  buffer.deleteBeforeCursor();
  assert.equal(buffer.value, "ef");
  assert.equal(buffer.cursorPos, 0);

  buffer.insertChar("X");
  buffer.deleteAfterCursor();
  assert.equal(buffer.value, "X");
  assert.equal(buffer.cursorPos, 1);
});

test("input buffer deletes the word before cursor", () => {
  const buffer = new InputBuffer();
  for (const ch of "npm run  build") buffer.insertChar(ch);

  buffer.deleteWordBeforeCursor();
  assert.equal(buffer.value, "npm run  ");
  assert.equal(buffer.cursorPos, "npm run  ".length);

  buffer.deleteWordBeforeCursor();
  assert.equal(buffer.value, "npm ");
  assert.equal(buffer.cursorPos, "npm ".length);
});

test("input buffer delete word respects cursor position", () => {
  const buffer = new InputBuffer();
  for (const ch of "alpha beta gamma") buffer.insertChar(ch);
  for (let i = 0; i < " gamma".length; i++) buffer.moveLeft();

  buffer.deleteWordBeforeCursor();
  assert.equal(buffer.value, "alpha  gamma");
  assert.equal(buffer.cursorPos, "alpha ".length);
});
