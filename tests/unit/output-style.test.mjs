import test from "node:test";
import assert from "node:assert/strict";

import { formatLocalPanel, formatKeyValueRows } from "../../dist/output-style.js";

test("output style formats a branded local panel with sections and boundary", () => {
  const lines = formatLocalPanel({
    icon: "◇",
    title: "本地上下文",
    sections: [
      {
        heading: "会话",
        rows: [
          ["Session ID", "session-test"],
          ["轮次", 3],
        ],
      },
      {
        heading: "路径",
        rows: [["Workspace", "C:\\repo\\qling"]],
      },
    ],
    boundary: "只展示本地统计，不调用模型。",
  });
  const text = lines.join("\n");

  assert.match(text, /◇ 轻灵 · 本地上下文/);
  assert.match(text, /会话/);
  assert.match(text, /Session ID\s+: session-test/);
  assert.match(text, /轮次\s+: 3/);
  assert.match(text, /路径/);
  assert.match(text, /边界\s+: 只展示本地统计，不调用模型。/);
  assert.equal(lines[0], "");
  assert.equal(lines.at(-1), "");
});

test("output style aligns key-value rows without mutating input rows", () => {
  const rows = [
    ["A", "one"],
    ["Long Label", "two"],
  ];
  const formatted = formatKeyValueRows(rows);

  assert.deepEqual(rows, [
    ["A", "one"],
    ["Long Label", "two"],
  ]);
  assert.equal(formatted[0], "A          : one");
  assert.equal(formatted[1], "Long Label : two");
});
