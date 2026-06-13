import test from "node:test";
import assert from "node:assert/strict";

import {
  findHelpTopic,
  formatFocusedHelp,
} from "../../dist/help-topics.js";

test("help topics resolve english slash and chinese aliases", () => {
  const english = findHelpTopic("exports");
  const slash = findHelpTopic("/exports");
  const chinese = findHelpTopic("导出列表");

  assert.equal(english?.id, "exports");
  assert.equal(slash?.id, "exports");
  assert.equal(chinese?.id, "exports");
});

test("focused slash help shows usage aliases examples and local boundary", () => {
  const lines = formatFocusedHelp("exports", { surface: "slash" });
  const text = lines.join("\n");

  assert.match(text, /聚焦帮助/);
  assert.match(text, /Topic\s*: exports/);
  assert.match(text, /Usage\s*: \/exports \[count\]/);
  assert.match(text, /Aliases\s*: \/导出列表/);
  assert.match(text, /\/exports 20/);
  assert.match(text, /只读取本地文件元数据/);
  assert.doesNotMatch(text, /qling exports 20/);
});

test("focused slash help shows skill command usage and local boundary", () => {
  const lines = formatFocusedHelp("skill", { surface: "slash" });
  const text = lines.join("\n");

  assert.match(text, /Topic\s*: skill/);
  assert.match(text, /Usage\s*: \/skill/);
  assert.match(text, /\/skill search <query>/);
  assert.match(text, /\/skill docker/);
  assert.match(text, /本地 skill|本地技能|本地/);
  assert.match(text, /不调用模型/);
});

test("focused cli help shows top-level examples", () => {
  const lines = formatFocusedHelp("exports", { surface: "cli", binName: "qling" });
  const text = lines.join("\n");

  assert.match(text, /Topic\s*: exports/);
  assert.match(text, /Usage\s*: qling exports \[count\]/);
  assert.match(text, /qling exports 20/);
  assert.match(text, /qling 导出列表 20/);
});

test("focused cli help suggests close unknown topics locally", () => {
  const english = formatFocusedHelp("expors", { surface: "cli", binName: "qling" }).join("\n");
  const chinese = formatFocusedHelp("导出列", { surface: "cli", binName: "qling" }).join("\n");

  assert.match(english, /未找到帮助主题 "expors"/);
  assert.match(english, /你是不是想看/);
  assert.match(english, /qling help exports/);
  assert.match(english, /Usage\s*: qling exports \[count\]/);

  assert.match(chinese, /未找到帮助主题 "导出列"/);
  assert.match(chinese, /你是不是想看/);
  assert.match(chinese, /qling help exports/);
  assert.match(chinese, /Usage\s*: qling exports \[count\]/);
});

test("focused slash help suggests close unknown topics locally", () => {
  const text = formatFocusedHelp("expors", { surface: "slash" }).join("\n");

  assert.match(text, /未找到帮助主题 "expors"/);
  assert.match(text, /你是不是想看/);
  assert.match(text, /\/help exports/);
  assert.match(text, /Usage\s*: \/exports \[count\]/);
});

test("focused help does not suggest weak unknown topics", () => {
  const text = formatFocusedHelp("zzzzzz", { surface: "cli", binName: "qling" }).join("\n");

  assert.match(text, /未找到帮助主题 "zzzzzz"/);
  assert.match(text, /qling help/);
  assert.doesNotMatch(text, /你是不是想看/);
  assert.doesNotMatch(text, /qling help exports/);
});

test("focused help explains unknown topics without throwing", () => {
  const text = formatFocusedHelp("missing-topic", { surface: "slash" }).join("\n");

  assert.match(text, /未找到帮助主题/);
  assert.match(text, /\/help/);
});
