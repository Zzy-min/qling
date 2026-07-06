import test from "node:test";
import assert from "node:assert/strict";

import { getLocalizedText } from "../../dist/i18n/index.js";
import { formatLocalGuidancePanel } from "../../dist/cli/guidance-panel.js";

test("zh-CN localized text exposes core panel labels and setup copy", () => {
  const t = getLocalizedText();

  assert.equal(t.product.name, "轻灵");
  assert.equal(t.labels.reason, "原因");
  assert.equal(t.labels.localExecution, "本地执行");
  assert.match(t.setup.quickPath, /系统环境变量/);
});

test("local guidance panel always declares local execution and model boundary", () => {
  const text = formatLocalGuidancePanel({
    title: "未知命令",
    reason: "输入看起来像命令。",
    next: "查看帮助。",
    example: "qling help",
  });

  assert.match(text, /原因: 输入看起来像命令。/);
  assert.match(text, /下一步: 查看帮助。/);
  assert.match(text, /示例: qling help/);
  assert.match(text, /本地执行: 是/);
  assert.match(text, /模型调用: 否/);
  assert.match(text, /边界: 本地处理/);
});
