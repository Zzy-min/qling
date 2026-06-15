import { default as stringWidth } from "string-width";

const sw = (s: string): number => stringWidth(s);

// ANSI 颜色与字体样式定义，保持跟 StreamUI 完全一致
const C = {
  p: "#36F5B5",   // primary  竹青绿
  s: "#75D7FF",   // secondary 青蓝
  d: "#8B949E",   // dim 灰
  b: "#E6EDF3",   // bright 白
  g: "#4ADE80",   // green
  r: "#FB7185",   // red
  y: "#FACC15",   // yellow
  m: "#E879F9",   // magenta
};

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`;
}

const F = (color: string, s: string): string => `\x1b[38;2;${rgb(color)}m${s}\x1b[0m`;

const S = {
  p: (s: string) => F(C.p, s),
  s: (s: string) => F(C.s, s),
  d: (s: string) => F(C.d, s),
  b: (s: string) => F(C.b, s),
  g: (s: string) => F(C.g, s),
  r: (s: string) => F(C.r, s),
  y: (s: string) => F(C.y, s),
  m: (s: string) => F(C.m, s),
};

const DIM = (s: string): string => `\x1b[2m${s}\x1b[0m`;
const BOLD = (s: string): string => `\x1b[1m${s}\x1b[0m`;

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

export function parseMarkdownTable(lines: string[]): ParsedTable | null {
  if (lines.length < 2) return null;

  function splitRow(line: string): string[] {
    const trimmed = line.trim();
    let active = trimmed;
    if (active.startsWith("|")) active = active.slice(1);
    if (active.endsWith("|") && !active.endsWith("\\|")) active = active.slice(0, -1);

    const cells: string[] = [];
    let current = "";
    for (let i = 0; i < active.length; i++) {
      if (active[i] === "\\" && active[i + 1] === "|") {
        current += "|";
        i++;
      } else if (active[i] === "|") {
        cells.push(current.trim());
        current = "";
      } else {
        current += active[i];
      }
    }
    cells.push(current.trim());
    return cells;
  }

  const sepLine = lines[1];
  if (!sepLine) return null;
  const sepCells = splitRow(sepLine);
  if (sepCells.length === 0) return null;

  const isValidSeparator = sepCells.every((cell) => {
    const c = cell.trim();
    if (c.length === 0) return false;
    return /^:?-+:?$/.test(c);
  });

  if (!isValidSeparator) return null;

  const headers = splitRow(lines[0] || "");
  const rows: string[][] = [];

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 如果这一行完全没有 |，则表示表格结束
    if (!line.includes("|")) {
      break;
    }

    const cells = splitRow(line);
    const rowCells = cells.slice(0, headers.length);
    while (rowCells.length < headers.length) {
      rowCells.push("");
    }
    rows.push(rowCells);
  }

  return { headers, rows };
}

function formatCell(cell: string, width: number): string {
  const w = sw(cell);
  if (w === width) return cell;
  if (w < width) {
    return cell + " ".repeat(width - w);
  }

  let col = 0;
  let index = 0;
  for (const char of cell) {
    const nextWidth = sw(char);
    if (col + nextWidth > width - 1) break;
    col += nextWidth;
    index += char.length;
  }
  const truncated = cell.slice(0, index) + "…";
  const tw = sw(truncated);
  return truncated + " ".repeat(Math.max(0, width - tw));
}

function wrapVisibleText(text: string, width: number, firstPrefix = "", restPrefix = ""): string[] {
  const safeWidth = Math.max(10, width);
  const lines: string[] = [];
  let prefix = firstPrefix;
  let contentWidth = Math.max(1, safeWidth - sw(prefix));
  let current = "";
  let currentWidth = 0;

  for (const char of Array.from(text)) {
    const charWidth = sw(char);
    if (current && currentWidth + charWidth > contentWidth) {
      lines.push(prefix + current);
      prefix = restPrefix;
      contentWidth = Math.max(1, safeWidth - sw(prefix));
      current = "";
      currentWidth = 0;
    }
    current += char;
    currentWidth += charWidth;
  }

  lines.push(prefix + current);
  return lines;
}

export function renderTable(table: ParsedTable, width: number): string[] {
  const colCount = table.headers.length;
  if (colCount === 0) return [];

  // 计算最大列宽
  const maxColWidths: number[] = new Array(colCount).fill(0);
  for (let c = 0; c < colCount; c++) {
    maxColWidths[c] = Math.max(maxColWidths[c], sw(table.headers[c] || ""));
    for (const row of table.rows) {
      maxColWidths[c] = Math.max(maxColWidths[c], sw(row[c] ?? ""));
    }
  }

  // 框线和内边距占的字符宽度 = 3 * colCount + 1
  const borderPadding = 3 * colCount + 1;
  const availWidth = Math.max(colCount * 4, width - borderPadding);

  let colWidths: number[] = [];
  const totalMax = maxColWidths.reduce((a, b) => a + b, 0);
  if (totalMax <= availWidth) {
    colWidths = [...maxColWidths];
  } else {
    // 按比例分配，最低限制每列 4 字符宽
    colWidths = maxColWidths.map((w) => {
      const allocated = Math.floor((w / totalMax) * availWidth);
      return Math.max(4, allocated);
    });

    let currentSum = colWidths.reduce((a, b) => a + b, 0);
    while (currentSum > availWidth) {
      let maxIdx = -1;
      let maxVal = 3;
      for (let i = 0; i < colCount; i++) {
        if (colWidths[i] > maxVal) {
          maxVal = colWidths[i];
          maxIdx = i;
        }
      }
      if (maxIdx === -1) break;
      colWidths[maxIdx]--;
      currentSum--;
    }
    while (currentSum < availWidth) {
      let minIdx = -1;
      let minVal = Infinity;
      for (let i = 0; i < colCount; i++) {
        if (colWidths[i] < minVal) {
          minVal = colWidths[i];
          minIdx = i;
        }
      }
      colWidths[minIdx]++;
      currentSum++;
    }
  }

  const lines: string[] = [];

  // top border
  let top = "┌";
  for (let c = 0; c < colCount; c++) {
    top += "─".repeat(colWidths[c] + 2);
    top += c < colCount - 1 ? "┬" : "┐";
  }
  lines.push(S.p(top));

  // header
  let headerLine = "│";
  for (let c = 0; c < colCount; c++) {
    headerLine += " " + BOLD(formatCell(table.headers[c] || "", colWidths[c])) + " │";
  }
  lines.push(S.p(headerLine));

  // separator
  let sep = "├";
  for (let c = 0; c < colCount; c++) {
    sep += "─".repeat(colWidths[c] + 2);
    sep += c < colCount - 1 ? "┼" : "┤";
  }
  lines.push(S.p(sep));

  // rows
  for (const row of table.rows) {
    let rowLine = "│";
    for (let c = 0; c < colCount; c++) {
      rowLine += " " + formatCell(row[c] || "", colWidths[c]) + " │";
    }
    lines.push(S.p(rowLine));
  }

  // bottom border
  let bottom = "└";
  for (let c = 0; c < colCount; c++) {
    bottom += "─".repeat(colWidths[c] + 2);
    bottom += c < colCount - 1 ? "┴" : "┘";
  }
  lines.push(S.p(bottom));

  return lines;
}

function renderInline(text: string): string {
  let res = text;
  // 替换加粗 **bold** -> BOLD(bold)
  res = res.replace(/\*\*(.*?)\*\*/g, (_, p1) => BOLD(p1));
  // 替换内联代码 `code` -> S.s(code)
  res = res.replace(/`(.*?)`/g, (_, p1) => S.s(p1));
  return res;
}

export function formatMarkdownForTerminal(text: string, options: { width: number }): string[] {
  const width = options.width || 80;
  const physicalLines = text.split("\n");
  const resultLines: string[] = [];

  let inCodeBlock = false;
  let i = 0;

  while (i < physicalLines.length) {
    const line = physicalLines[i];
    if (line === undefined) {
      i++;
      continue;
    }

    // 1. 处理代码块开始/结束
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      const border = "─".repeat(Math.max(10, width - 4));
      resultLines.push(DIM(inCodeBlock ? "  ┌" + border : "  └" + border));
      i++;
      continue;
    }

    // 2. 如果在代码块内部
    if (inCodeBlock) {
      resultLines.push("  " + DIM(line));
      i++;
      continue;
    }

    // 3. 表格检测
    if (line.includes("|") && i + 1 < physicalLines.length) {
      const nextLine = physicalLines[i + 1] || "";
      if (nextLine.includes("|")) {
        const tableLines: string[] = [];
        let j = i;
        while (j < physicalLines.length) {
          const curr = physicalLines[j];
          if (curr === undefined || !curr.includes("|")) {
            break;
          }
          tableLines.push(curr);
          j++;
        }

        if (tableLines.length >= 2) {
          const table = parseMarkdownTable(tableLines);
          if (table) {
            const renderedTableLines = renderTable(table, width);
            resultLines.push(...renderedTableLines);
            i = j; // 跳转到表格后
            continue;
          }
        }
      }
    }

    // 4. 标题处理 (# 开头)
    const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      const content = headerMatch[2] || "";
      resultLines.push("");
      resultLines.push(...wrapVisibleText(content, width).map((wrapped) => S.p(BOLD(renderInline(wrapped)))));
      resultLines.push("");
      i++;
      continue;
    }

    // 5. 无序列表
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ulMatch) {
      const indent = ulMatch[1] || "";
      const content = ulMatch[2] || "";
      const firstPrefix = indent + "  • ";
      const restPrefix = indent + "    ";
      resultLines.push(...wrapVisibleText(content, width, firstPrefix, restPrefix).map(renderInline));
      i++;
      continue;
    }

    // 6. 有序列表
    const olMatch = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
    if (olMatch) {
      const indent = olMatch[1] || "";
      const num = olMatch[2] || "";
      const content = olMatch[3] || "";
      const firstPrefix = indent + "  " + num + " ";
      const restPrefix = indent + " ".repeat(sw("  " + num + " "));
      resultLines.push(...wrapVisibleText(content, width, firstPrefix, restPrefix).map(renderInline));
      i++;
      continue;
    }

    // 7. 普通行
    resultLines.push(...wrapVisibleText(line, width).map(renderInline));
    i++;
  }

  // 过滤多余的连续物理空行
  const cleaned: string[] = [];
  for (let idx = 0; idx < resultLines.length; idx++) {
    const curr = resultLines[idx];
    const prev = cleaned[cleaned.length - 1];
    if (curr === "" && prev === "") {
      continue;
    }
    cleaned.push(curr ?? "");
  }

  return cleaned;
}
