import test from "node:test";
import assert from "node:assert/strict";
import stringWidth from "string-width";
import { formatInfoCard, formatFlatInfoPanels } from "../../dist/tui/info-card.js";

test("info card keeps a uniform rounded frame and aligned label column", () => {
  const lines = formatInfoCard({
    title: "📚 轻灵知识库",
    subtitle: "本地优先 · 中文 RAG",
    rows: [
      { label: "用法", value: "/knowledge <问题>   或   /knowledge index <目录>" },
      { label: "推荐模型", value: "DeepSeek / Qwen / GLM + 中文 embedding" },
      { label: "隐私边界", value: "仅本地索引 · 不上传 · 不默认联网" },
    ],
    footer: "提示: /knowledge index . 建立本地索引后可直接检索",
    width: 72,
  });

  assert.deepEqual([...new Set(lines.map((line) => stringWidth(line)))], [72]);
  assert.match(lines[0], /^╭─ 📚 轻灵知识库 · 本地优先 · 中文 RAG /);
  assert.match(lines[0], /╮$/);
  assert.ok(lines.every((line) => line.startsWith("│") || line.startsWith("╭") || line.startsWith("╰")));
  assert.match(lines.join("\n"), /用法\s+\/knowledge/);
  assert.match(lines.join("\n"), /隐私边界\s+仅本地索引/);
});

test("info card wraps long values and footer inside narrow width", () => {
  const lines = formatInfoCard({
    title: "知识库",
    rows: [{ label: "说明", value: "这是一段很长的说明文字，用来验证窄宽终端下的自动换行与右边框对齐。" }],
    footer: "一段同样需要换行的页脚提示，确保不会把右边框推出去。",
    width: 36,
  });
  assert.deepEqual([...new Set(lines.map((line) => stringWidth(line)))], [36]);
  assert.ok(lines.length > 4, "value and footer should wrap onto extra rows");
  assert.ok(lines.every((line) => line.endsWith("│") || line.endsWith("╮") || line.endsWith("╯")));
});

test("legacy dashboard panel upgrades to a rounded card", () => {
  const legacy = [
    "",
    "📊 【轻灵任务工作台 / Mission Control】",
    "-----------------------------------------",
    "本地链接 : http://127.0.0.1:9999",
    "状态     : 运行中（仅 127.0.0.1）",
    "用途     : 查看 mission / loop / workflow · 暂停/恢复 · 最近会话",
    "-----------------------------------------",
    "",
  ].join("\n");
  const upgraded = formatFlatInfoPanels(legacy, 76);
  assert.match(upgraded, /╭─ 📊 轻灵任务工作台/);
  assert.match(upgraded, /本地链接\s+http:\/\/127\.0\.0\.1:9999/);
  assert.doesNotMatch(upgraded, /-{20,}/);
});

test("command list panels are not forced into key-value cards", () => {
  const help = [
    "",
    "【轻灵 Slash Commands】",
    "-----------------------------------------",
    "/help, /?               - 显示此帮助信息",
    "/model [list|use <p>]   - 模型切换器",
    "-----------------------------------------",
  ].join("\n");
  assert.equal(formatFlatInfoPanels(help, 76), help);
});
