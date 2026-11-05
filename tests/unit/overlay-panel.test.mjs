import test from "node:test";
import assert from "node:assert/strict";

import {
  formatOptionPickerPanel,
  formatSessionPickerPanel,
  formatTurnBrowsePanel,
  paintOptionPickerPanel,
  renderSessionPickerPanel,
  renderOptionPickerPanel,
} from "../../dist/tui/overlay-panel.js";
import { visibleWidth } from "../../dist/tui/shell.js";

test("session picker panel lists items and footer", () => {
  const lines = formatSessionPickerPanel(
    [
      {
        sessionId: "sess-aaa",
        name: "工作台",
        updatedAt: "2026-07-16T08:00:00.000Z",
        turnCount: 3,
        messageCount: 6,
        active: true,
      },
      {
        sessionId: "sess-bbb",
        name: "实验",
        updatedAt: "2026-07-15T08:00:00.000Z",
        turnCount: 1,
        messageCount: 2,
      },
    ],
    0,
    80
  );
  const text = lines.join("\n");
  // G4 舰队标题（对标 Grok Agent Dashboard）
  assert.match(text, /会话舰队|Session Dashboard/);
  assert.match(text, /工作台/);
  assert.match(text, /sess-aaa/);
  assert.match(text, /Enter 恢复/);
  assert.match(text, /▸/);
  assert.match(text, /●/); // active 状态图标
  assert.match(text, /当前/);
});

test("session fleet empty state guides first message", () => {
  const lines = formatSessionPickerPanel([], 0, 80);
  const text = lines.join("\n");
  assert.match(text, /尚无会话/);
  assert.match(text, /第一轮对话|开始/);
  assert.match(text, /会话舰队|Session Dashboard/);
});

test("turn browse panel shows previews", () => {
  const lines = formatTurnBrowsePanel(
    [
      { index: 0, preview: "分析仓库结构" },
      { index: 1, preview: "继续修 TUI" },
    ],
    1,
    80
  );
  const text = lines.join("\n");
  assert.match(text, /轮次浏览/);
  assert.match(text, /分析仓库/);
  assert.match(text, /#2/);
  assert.match(text, /PgUp/);
});

test("option picker windows long lists with stable height and ▸", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    id: `id-${i}`,
    label: `opt-${i}`,
    description: `desc ${i}`,
  }));
  const a = formatOptionPickerPanel("测试切换", many, 0, 80);
  const b = formatOptionPickerPanel("测试切换", many, 10, 80);
  const c = formatOptionPickerPanel("测试切换", many, 19, 80);
  assert.equal(a.length, b.length);
  assert.equal(b.length, c.length);
  assert.match(a.join("\n"), /测试切换/);
  assert.match(a.join("\n"), /▸/);
  assert.match(b.join("\n"), /opt-10/);
  assert.match(c.join("\n"), /opt-19/);
  assert.match(a.join("\n"), /共 20|浏览全部|条/);
});

test("option picker respects terminal row budget with multiline input", () => {
  const many = Array.from({ length: 268 }, (_, i) => ({
    id: `id-${i}`,
    label: `opt-${i}`,
    description: `description ${i}`,
  }));
  for (const [rows, columns] of [[24, 80], [30, 100], [50, 160]]) {
    for (const selected of [0, 133, 267]) {
      const lines = formatOptionPickerPanel(
        "268 项切换器",
        many,
        selected,
        columns,
        undefined,
        { terminalRows: rows, inputRows: 3, statusRows: 1 }
      );
      assert.ok(lines.length + 3 + 1 <= rows, `${rows}x${columns}: panel overlays input/status`);
      assert.match(lines.join("\n"), new RegExp(`opt-${selected}`));
      assert.match(lines.join("\n"), /268/);
    }
  }
});

test("session picker windows long lists with stable height", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    sessionId: `id-${i}`,
    name: `s-${i}`,
    updatedAt: "2026-07-16T00:00:00.000Z",
    turnCount: 1,
    messageCount: 1,
  }));
  const a = formatSessionPickerPanel(many, 0, 80);
  const b = formatSessionPickerPanel(many, 10, 80);
  const c = formatSessionPickerPanel(many, 19, 80);
  assert.equal(a.length, b.length);
  assert.equal(b.length, c.length);
  assert.match(a.join("\n"), /▸/);
  assert.match(b.join("\n"), /s-10/);
  assert.match(c.join("\n"), /s-19/);
  // 全量可浏览：footer 声明总数，不因窗口截断数据
  assert.match(a.join("\n"), /共 20|浏览全部 20/);
});

test("pickers keep an exact frame width and surface item counts", () => {
  const items = [
    {
      id: "model",
      label: "/model",
      description: "切换模型",
      active: true,
      tag: "常用",
      hint: "<name>",
    },
    { id: "theme", label: "/theme", description: "切换主题", hint: "bamboo|night" },
    { id: "sandbox", label: "/sandbox" },
  ];
  for (const columns of [40, 80, 120]) {
    const expected = Math.min(columns, 100);
    for (const lines of [
      formatOptionPickerPanel("命令切换器", items, 1, columns),
      formatTurnBrowsePanel([{ index: 0, preview: "分析仓库结构" }], 0, columns),
    ]) {
      for (const line of lines) {
        assert.equal(visibleWidth(line), expected, `${columns} 列下每行宽度必须一致`);
      }
    }
  }
  const optionText = formatOptionPickerPanel("命令切换器", items, 1, 80).join("\n");
  assert.match(optionText, /命令切换器 · 3 项/);
  assert.match(optionText, /● 当前/);
  assert.match(optionText, /▸ \/theme/);
  assert.match(optionText, /\[常用\]/);
  assert.match(optionText, /<name>/);
  assert.match(optionText, /bamboo\|night/);
});

test("disabled picker rows do not count as choices or steal the cursor", () => {
  const lines = formatOptionPickerPanel(
    "命令切换",
    [
      {
        id: "",
        label: "(无匹配)",
        description: "继续输入或 Backspace",
        disabled: true,
      },
    ],
    0,
    60
  );
  const text = lines.join("\n");
  assert.match(text, /0 项/);
  assert.match(text, /共 0 条/);
  assert.match(text, /\(无匹配\)/);
  assert.doesNotMatch(text, /▸/);
});

test("section headers group commands without repeating category tags", () => {
  const lines = formatOptionPickerPanel(
    "命令切换 · Slash",
    [
      { id: "", label: "常用", section: true, disabled: true },
      { id: "/help", label: "/help", tag: "常用", description: "显示可用指令列表" },
      { id: "", label: "Git", section: true, disabled: true },
      { id: "/diff", label: "/diff", tag: "Git", description: "查看改动" },
    ],
    1,
    80
  );
  const text = lines.join("\n");
  assert.match(text, /▼ 常用/);
  assert.match(text, /▼ Git/);
  assert.match(text, /\/help/);
  assert.match(text, /2 项/);
  // 分组头已表达分类，行内不再重复 [常用]/[Git]
  assert.doesNotMatch(text, /\[常用\]|\[Git\]/);
});

test("narrow picker footer drops low-value hints before action keys", () => {
  const lines = formatOptionPickerPanel(
    "命令切换",
    [{ id: "/help", label: "/help" }],
    0,
    40,
    "键入检索 · ↑/↓ · PgUp/PgDn · 可带参数 · Enter · Esc"
  );
  const footer = lines.at(-2);
  assert.ok(footer);
  assert.match(footer, /键入检索/);
  assert.match(footer, /↑\/↓/);
  assert.match(footer, /Enter/);
  assert.match(footer, /Esc/);
  assert.doesNotMatch(footer, /可带参数/);
});

test("picker paint gives the selection an inverse bar and keeps the active row readable", () => {
  const items = [
    { id: "model", label: "/model", active: true },
    { id: "theme", label: "/theme" },
  ];
  const lines = paintOptionPickerPanel(
    formatOptionPickerPanel("命令切换器", items, 1, 60)
  ).split("\n");
  const activeLine = lines.find((line) => line.includes("/model"));
  const selectedLine = lines.find((line) => line.includes("/theme"));
  const footerLine = lines.at(-2);
  assert.ok(activeLine && selectedLine && footerLine);
  assert.match(activeLine, /\x1b\[38;2;/);
  assert.doesNotMatch(activeLine, /\x1b\[7;/);
  assert.match(selectedLine, /\x1b\[7;38;2;/);
  assert.match(footerLine, /\x1b\[38;2;/);
});

test("picker paint accents query hits and category tags", () => {
  const items = [
    { id: "help", label: "/help", tag: "常用" },
    { id: "theme", label: "/theme", tag: "主题" },
  ];
  const lines = paintOptionPickerPanel(
    formatOptionPickerPanel("命令切换器", items, 1, 60),
    "/hel"
  ).split("\n");
  const plain = (line) => line.replace(/\x1b\[[0-9;]*m/g, "");
  const helpLine = lines.find((line) => plain(line).includes("/help"));
  assert.ok(helpLine);
  const colors = new Set(
    Array.from(helpLine.matchAll(/\x1b\[(?:7;)?38;2;([0-9;]+)m/g), (m) => m[1])
  );
  // dim 基础色 + 命中主色 + [tag] 品红色至少三种
assert.ok(colors.size >= 3, `expected accent spans, got ${colors.size}`);
});

test("picker hover rows are visually distinct from normal rows", () => {
  const items = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ];
  const plain = formatOptionPickerPanel("命令", items, 0, 60);
  const normal = paintOptionPickerPanel(plain).split("\n");
  const hovered = paintOptionPickerPanel(plain, undefined, new Set([2])).split("\n");
  assert.notEqual(normal[2], hovered[2]);
  assert.match(hovered[2], /\x1b\[38;2;/);
});

test("session picker exposes row mapping for the two-line rows", () => {
  const rendered = renderSessionPickerPanel(
    [
      {
        sessionId: "s1",
        name: "one",
        updatedAt: new Date(0).toISOString(),
        turnCount: 1,
        messageCount: 2,
      },
    ],
    0,
    60,
    0
  );
  assert.equal(rendered.rowItems.length, rendered.lines.length);
  assert.deepEqual(rendered.rowItems.slice(0, 4), [null, 0, 0, null]);
});

test("option picker replaces ▲/▼ hints with a proportional scrollbar", () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    id: `/cmd-${i}`,
    label: `/cmd-${i}`,
  }));
  const top = renderOptionPickerPanel("命令", items, 0, 60, undefined, {
    terminalRows: 24,
    inputRows: 3,
    statusRows: 1,
  });
  const topText = top.lines.join("\n");
  assert.doesNotMatch(topText, /▲|▼/);
  assert.match(topText, /█/);
  assert.match(topText, /▏/);
  assert.equal(top.rowItems.length, top.lines.length);
  assert.equal(top.rowItems[0], null);
  assert.equal(top.rowItems.at(-1), null);
  assert.equal(visibleWidth(top.lines[1]), 60);
  assert.match(top.lines[1], /█/);

  const bottom = formatOptionPickerPanel("命令", items, 29, 60, undefined, {
    terminalRows: 24,
    inputRows: 3,
    statusRows: 1,
  });
  assert.match(bottom.at(-3), /█/);
});

test("collapsed sections keep the header and hide their commands", () => {
  const lines = formatOptionPickerPanel(
    "命令",
    [
      {
        id: "",
        label: "高级",
        section: true,
        disabled: true,
        collapsible: true,
        collapsed: true,
        sectionCount: 1,
      },
    ],
    1,
    60
  );
  const text = lines.join("\n");
  assert.match(text, /▶ 高级 \(1\)/);
  assert.doesNotMatch(text, /\/skill-hidden/);
});






