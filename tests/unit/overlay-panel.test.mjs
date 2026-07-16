import test from "node:test";
import assert from "node:assert/strict";

import {
  formatOptionPickerPanel,
  formatSessionPickerPanel,
  formatTurnBrowsePanel,
} from "../../dist/tui/overlay-panel.js";

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
  assert.match(text, /会话切换/);
  assert.match(text, /工作台/);
  assert.match(text, /sess-aaa/);
  assert.match(text, /Enter 恢复/);
  assert.match(text, /▸/);
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
