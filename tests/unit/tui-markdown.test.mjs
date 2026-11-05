import test from "node:test";
import assert from "node:assert/strict";
import stringWidth from "string-width";

import {
  parseMarkdownTable,
  formatMarkdownForTerminal,
  renderTable
} from "../../dist/tui/markdown.js";

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("markdown table parser correctly parses valid tables", () => {
  const tableLines = [
    "| Header 1 | Header 2 |",
    "| :--- | :--- |",
    "| Row 1 Col 1 | Row 1 Col 2 |",
    "| Row 2 Col 1 | Row 2 Col 2 |"
  ];
  const table = parseMarkdownTable(tableLines);
  assert.ok(table);
  assert.equal(table.headers.length, 2);
  assert.equal(table.headers[0], "Header 1");
  assert.equal(table.headers[1], "Header 2");
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0][0], "Row 1 Col 1");
  assert.equal(table.rows[1][1], "Row 2 Col 2");
});

test("markdown table parser fails on invalid separator line", () => {
  const tableLines = [
    "| Header 1 | Header 2 |",
    "| Not a separator | row |",
    "| Row 1 Col 1 | Row 1 Col 2 |"
  ];
  const table = parseMarkdownTable(tableLines);
  assert.equal(table, null);
});

test("markdown renderer leaves pipe logs as normal text when separator is invalid", () => {
  const rendered = formatMarkdownForTerminal("status=200 | content-type=text/html\nv_sz000100=4.62|+0.07", { width: 80 });
  const text = stripAnsi(rendered.join("\n"));

  assert.match(text, /status=200 \| content-type=text\/html/);
  assert.match(text, /v_sz000100=4.62\|\+0.07/);
  assert.doesNotMatch(text, /┌/);
});

test("markdown renderer wraps long paragraphs and lists to terminal width", () => {
  const rendered = formatMarkdownForTerminal([
    "这是一个很长的普通段落，用来确认终端输出不会因为没有换行而横向溢出窗口，尤其是在中文和英文 mixed content 一起出现的时候。",
    "- 这是一个很长的列表项，用来确认第二行会保留列表缩进并且不会破坏整体阅读体验。"
  ].join("\n"), { width: 32 });

  const plainLines = rendered.map(stripAnsi).filter(Boolean);
  assert.ok(plainLines.length > 3);
  for (const line of plainLines) {
    assert.ok(stringWidth(line) <= 32, `line exceeded width: ${line}`);
  }
  assert.match(plainLines.join("\n"), /  • /);
  assert.match(plainLines.join("\n"), /\n    /);
});


test("markdown table parser handles tables without side borders", () => {
  const tableLines = [
    "Header 1 | Header 2",
    "--- | ---",
    "Row 1 | Row 2"
  ];
  const table = parseMarkdownTable(tableLines);
  assert.ok(table);
  assert.equal(table.headers[0], "Header 1");
  assert.equal(table.rows[0][0], "Row 1");
});

test("markdown table parser preserves explicit column alignment markers", () => {
  const parsed = parseMarkdownTable([
    "| 左 | 中 | 右 |",
    "|:---|:---:|---:|",
    "| a | b | c |"
  ]);
  assert.ok(parsed);
  assert.deepEqual(parsed.alignments, ["left", "center", "right"]);
});

test("markdown renderer formats headers, lists, codeblocks, and tables", () => {
  const md = `
# title-header

- list item 1
- list item 2

\`\`\`javascript
const x = 1;
\`\`\`

| A | B |
|---|---|
| A1 | B1 |
`;

  const rendered = formatMarkdownForTerminal(md, { width: 80 });
  const text = rendered.join("\n");
  const plainText = stripAnsi(text);

  // 断言标题被渲染
  assert.match(text, /title-header/);
  // 断言列表圆点被加入
  assert.match(text, /• list item 1/);
  assert.match(text, /• list item 2/);
  // 断言代码块被渲染且去除了 \`\`\`
  assert.doesNotMatch(text, /```/);
  assert.match(text, /const x = 1;/);
  // 断言表格被渲染成 Box Table (含 ┌, ┬, ┐, └ 等)
  assert.match(text, /┌/);
  assert.match(plainText, /│ A1/);
});

test("markdown table rendering aligns Chinese wide characters without layout drift", () => {
  const table = {
    headers: ["中文列", "Eng Col"],
    rows: [
      ["一二三", "row 1"],
      ["四五", "row 2"]
    ]
  };

  const rendered = renderTable(table, 80);

  // 所有的物理行（去掉 ANSI 转义后）的可视宽度应该完全相同，保证边框绝对对齐
  const widths = rendered.map(line => {
    const raw = stripAnsi(line);
    // 计算可视宽度，中文为 2，英文为 1
    // 我们用一个简单的可视宽度累加器，或者引入 string-width
    // 在这里可以用一个简单的度量逻辑验证
    let w = 0;
    for (const char of raw) {
      // 匹配中文字符
      w += /[\u4e00-\u9fa5]/.test(char) ? 2 : 1;
    }
    return w;
  });

  assert.ok(widths.length > 0);
  const firstWidth = widths[0];
  for (const w of widths) {
    assert.equal(w, firstWidth);
  }
});

test("markdown table numeric columns right-align and keep headers on one line", () => {
  const rendered = formatMarkdownForTerminal([
    "| 个股 | 近5日 | 近10日 | 主力净流入 |",
    "|---|---:|---:|---:|",
    "| 三利谱 | -14.18% | -10.07% | -0.89亿 |",
    "| 京东方A | -11.91% | -15.22% | -11.16亿 |",
    "| TCL科技 | -2.24% | -2.67% | +0.27亿 |",
  ].join("\n"), { width: 100 });
  const plain = rendered.map(stripAnsi);
  const text = plain.join("\n");

  // 表头不换行，数值列按右对齐补齐
  assert.match(text, /主力净流入\s*│/);
  assert.match(text, /│\s+-2\.24%\s*│\s+-2\.67%\s*│\s+\+0\.27亿\s*│/);
  assert.match(text, /│\s+-14\.18%\s*│/);
});

test("markdown table wraps long cells without losing content or overflowing width", () => {
  for (const width of [28, 40, 56]) {
    const rendered = formatMarkdownForTerminal([
      "| 公司 | 说明 | 主力净流入 |",
      "|---|---|---:|",
      "| 京东方A | 龙头下跌，面板价格承压，资金持续流出 | -11.16亿 |",
      "| TCL科技 | 子公司股权结构变动，计提资产减值准备 | +0.27亿 |",
    ].join("\n"), { width });
    const plain = rendered.map(stripAnsi);
    const tableLines = plain.filter((line) => /^[┌├│└]/.test(line));
    const widths = tableLines.map((line) => stringWidth(line));

    assert.equal(new Set(widths).size, 1, `row widths drifted at ${width}:\n${plain.join("\n")}`);
    assert.ok(widths.every((value) => value <= width), `table overflows ${width} columns:\n${plain.join("\n")}`);
    assert.match(plain.join("\n"), /主力净流入|主力净/);
    assert.match(plain.join("\n"), /资产|减值|准备/);
    assert.doesNotMatch(plain.join("\n"), /…/, "long cells should wrap instead of being truncated");
  }
});

test("markdown table rendering strips inline markers and draws row grid separators", () => {
  const rendered = formatMarkdownForTerminal([
    "| 项目 | 数据 |",
    "|---|---|",
    "| **最新价** | **¥4.62** |",
    "| **涨跌幅** | **+1.54%** ↑ |",
    "| **成交额** | ~42.47 亿元 |"
  ].join("\n"), { width: 80 });

  const plain = rendered.map(stripAnsi);
  const text = plain.join("\n");
  const tableLines = plain.filter((line) => /^[┌├│└]/.test(line));
  const widths = tableLines.map((line) => stringWidth(line));

  assert.doesNotMatch(text, /\*\*/);
  assert.match(text, /│ 最新价/);
  assert.match(text, /│ ¥4\.62/);
  assert.ok(plain.filter((line) => line.startsWith("├")).length >= 3);
  assert.equal(new Set(widths).size, 1, `table widths drifted: ${widths.join(", ")}`);
});

test("markdown codeblock borders never overflow width or leave trailing truncated brackets", () => {
  for (const width of [40, 80, 114]) {
    const rendered = formatMarkdownForTerminal(
      [
        "```",
        "build.py             构建（预处理 + 渲染）",
        "verify.py            结构核验",
        "```",
        "",
        "```typescript",
        "const ok = true;",
        "```",
      ].join("\n"),
      { width }
    );
    const plainLines = rendered.map(stripAnsi).filter(Boolean);
    const borderLines = plainLines.filter((line) => line.startsWith("  ┌") || line.startsWith("  └"));
    assert.equal(borderLines.length, 4);
    for (const line of plainLines) {
      assert.ok(
        stringWidth(line) <= width,
        `line width ${stringWidth(line)} exceeded ${width}: ${line}`
      );
      assert.doesNotMatch(line, /\[\.\.\.|\[…/);
    }
    // Top and bottom borders of each codeblock have identical visual width (width - 1)
    for (const border of borderLines) {
      assert.equal(stringWidth(border), width - 1);
    }
    assert.match(borderLines[2], /^  ┌─ typescript ─+$/);
  }
});

test("markdown inline bold and code spans across soft line wraps never leak raw asterisks or backticks", () => {
  const input =
    "本周 A 股是“周线收阴、周五反包”的分化周：上证全周 -0.69%，但周五单日 +0.89% 收复大半失地，成交额放大到 1.96 万亿；**大盘权重和成长龙头表现偏弱，中小盘指数反而收红**（中证1000 +0.79%、中证500 +0.62%，而沪深300 -1.57%、创业板指 -3.18%）。";
  const rendered = formatMarkdownForTerminal(input, { width: 116 });
  const plainLines = rendered.map(stripAnsi);
  assert.ok(plainLines.length >= 2);
  for (const line of plainLines) {
    assert.ok(stringWidth(line) <= 116, `line exceeded width 116: ${line}`);
    assert.doesNotMatch(line, /\*\*/);
  }
  assert.match(rendered[0], /\x1b\[1m大\x1b\[0m$/);
  assert.match(rendered[1], /^\x1b\[1m盘权重和成长龙头表现偏弱，中小盘指数反而收红\x1b\[0m/);
});
