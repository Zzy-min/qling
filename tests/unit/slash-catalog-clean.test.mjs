import test from "node:test";
import assert from "node:assert/strict";
import {
  getSlashCommandCatalog,
  listExecutableSlashCommandsForPicker,
  formatGroupedSlashPanel,
} from "../../dist/commands/index.js";

test("slash catalog excludes unsupported Claude placeholders", () => {
  const catalog = getSlashCommandCatalog({ includeUnsupported: false });
  const names = catalog.map((c) => c.name);
  assert.ok(names.includes("/help"));
  assert.ok(names.includes("/model"));
  assert.ok(!names.includes("/login"));
  assert.ok(!names.includes("/desktop"));
  assert.ok(!names.includes("/teleport"));
});

test("slash skill catalog excludes archive/examples and has real descriptions", () => {
  const catalog = getSlashCommandCatalog({ includeUnsupported: false });
  const names = catalog.map((c) => c.name);
  assert.ok(!names.includes("/archive"));
  assert.ok(!names.includes("/examples"));
  assert.ok(!names.includes("/templates"));
  const skills = catalog.filter((c) => c.category === "skill");
  for (const s of skills) {
    assert.notEqual(s.description, "本地 skill 直接调用");
    assert.ok(s.description.length > 0);
  }
  // lifecycle skills if present should use real description
  const build = catalog.find((c) => c.name === "/lifecycle-build");
  if (build) {
    assert.match(build.description, /实现|计划|代码|验证/i);
  }
});

test("grouped panel does not list Claude cloud placeholders", () => {
  const text = formatGroupedSlashPanel(100).join("\n");
  assert.doesNotMatch(text, /\/login|\/desktop|\/teleport/);
  assert.doesNotMatch(text, /\/archive|\/examples/);
  assert.match(text, /切换器|Enter/);
});

test("picker list is non-empty and executable-only", () => {
  const list = listExecutableSlashCommandsForPicker();
  assert.ok(list.length > 5);
  assert.ok(list.every((i) => i.id.startsWith("/")));
  assert.ok(!list.some((i) => i.id === "/login"));
});
