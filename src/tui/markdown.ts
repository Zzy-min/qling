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

export type TableAlignment = "left" | "right" | "center";

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  /** Markdown 分隔行声明的列对齐；缺省按列内容推断。 */
  alignments?: TableAlignment[];
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

  const alignments: TableAlignment[] = headers.map((_header, index) => {
    const marker = (sepCells[index] ?? "").trim();
    const left = marker.startsWith(":");
    const right = marker.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });

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

  return { headers, rows, ...(alignments.some((_value, index) => /^:|:$/.test((sepCells[index] ?? "").trim())) ? { alignments } : {}) };
}

/** 表格单元格分词：CJK/宽字符逐字可断，拉丁词与数字整体保持。 */
function tokenizeTableCell(text: string): string[] {
  const tokens: string[] = [];
  let word = "";
  for (const char of text) {
    if (/\s/.test(char)) {
      if (word) {
        tokens.push(word);
        word = "";
      }
      tokens.push(" ");
    } else if (sw(char) >= 2) {
      if (word) {
        tokens.push(word);
        word = "";
      }
      tokens.push(char);
    } else {
      word += char;
    }
  }
  if (word) tokens.push(word);
  return tokens;
}

/** 按显示宽度换行，保留单词完整性；超长单词按字符硬切。 */
function wrapTableCell(text: string, width: number): string[] {
  if (!text) return [""];
  const safeWidth = Math.max(1, width);
  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;

  const flush = (): void => {
    if (current.trimEnd()) lines.push(current.trimEnd());
    current = "";
    currentWidth = 0;
  };

  for (const token of tokenizeTableCell(text)) {
    const tokenWidth = sw(token);
    if (token === " " && currentWidth === 0) continue;
    if (currentWidth + tokenWidth <= safeWidth) {
      current += token;
      currentWidth += tokenWidth;
      continue;
    }
    flush();
    if (token === " ") continue;
    if (tokenWidth <= safeWidth) {
      current = token;
      currentWidth = tokenWidth;
      continue;
    }
    for (const char of token) {
      const charWidth = Math.max(1, sw(char));
      if (currentWidth + charWidth > safeWidth && currentWidth > 0) flush();
      current += char;
      currentWidth += charWidth;
    }
  }
  flush();
  return lines.length > 0 ? lines : [""];
}

function padTableCell(text: string, width: number, alignment: TableAlignment): string {
  const textWidth = sw(text);
  const padding = Math.max(0, width - textWidth);
  if (alignment === "right") return " ".repeat(padding) + text;
  if (alignment === "center") {
    const left = Math.floor(padding / 2);
    return " ".repeat(left) + text + " ".repeat(padding - left);
  }
  return text + " ".repeat(padding);
}

/** 无显式对齐时，纯数值列默认右对齐，符合金融/统计表格阅读习惯。 */
function inferTableAlignment(cells: string[]): TableAlignment {
  const values = cells.filter((cell) => cell.trim().length > 0);
  if (values.length < 2) return "left";
  const numeric = /^[¥￥$€£]?[-+±]?[\d,]+(?:\.\d+)?(?:%|‰|亿|万|元|股)?$/;
  return values.every((cell) => numeric.test(cell.trim())) ? "right" : "left";
}

function normalizeTableCell(cell: string): string {
  return cell
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]*?)`/g, "$1")
    .trim();
}

function wrapVisibleText(text: string, width: number, firstPrefix = "", restPrefix = ""): string[] {
  const safeWidth = Math.max(10, width);
  const lines: string[] = [];
  let prefix = firstPrefix;
  let contentWidth = Math.max(1, safeWidth - sw(prefix));
  let current = "";
  let currentWidth = 0;
  let activeAnsi = "";

  for (let idx = 0; idx < text.length;) {
    const ansiMatch = text.slice(idx).match(/^\x1b\[[0-9;]*m/);
    if (ansiMatch) {
      const seq = ansiMatch[0];
      current += seq;
      if (seq === "\x1b[0m") {
        activeAnsi = "";
      } else {
        activeAnsi += seq;
      }
      idx += seq.length;
      continue;
    }

    const cp = text.codePointAt(idx);
    if (cp === undefined) break;
    const char = String.fromCodePoint(cp);
    const charWidth = sw(char);
    if (currentWidth > 0 && currentWidth + charWidth > contentWidth) {
      const cleanedCurrent = current.replace(/(?:\x1b\[[0-9;]*m)+$/, "");
      const needsReset = /\x1b\[[0-9;]*m/.test(cleanedCurrent) && !cleanedCurrent.endsWith("\x1b[0m");
      lines.push(prefix + cleanedCurrent + (needsReset ? "\x1b[0m" : ""));
      prefix = restPrefix;
      contentWidth = Math.max(1, safeWidth - sw(prefix));
      current = activeAnsi;
      currentWidth = 0;
    }
    current += char;
    currentWidth += charWidth;
    idx += char.length;
  }

  lines.push(prefix + current + (activeAnsi ? "\x1b[0m" : ""));
  return lines;
}

export function renderTable(table: ParsedTable, width: number): string[] {
  const colCount = table.headers.length;
  if (colCount === 0) return [];

  const headers = table.headers.map(normalizeTableCell);
  const rows = table.rows.map((row) => row.map(normalizeTableCell));
  const allRows = [headers, ...rows];

  // 每列自然宽度与不可断词的最小宽度
  const naturalWidths: number[] = new Array(colCount).fill(1);
  const minWidths: number[] = new Array(colCount).fill(1);
  for (let c = 0; c < colCount; c++) {
    for (const row of allRows) {
      const cell = row[c] ?? "";
      naturalWidths[c] = Math.max(naturalWidths[c], sw(cell));
      for (const token of tokenizeTableCell(cell)) {
        minWidths[c] = Math.max(minWidths[c], sw(token));
      }
    }
    // 表头尽量保持单行，避免“主力净流入”被压成“主力净流 / 入”
    minWidths[c] = Math.max(
      1,
      Math.min(naturalWidths[c], Math.max(minWidths[c], sw(headers[c] ?? "")))
    );
  }

  // 框线和左右内边距占宽：每列 3 列宽 + 1 个收尾边框
  const borderPadding = 3 * colCount + 1;
  const budget = Math.max(colCount, Math.floor(width) - borderPadding);
  const totalNatural = naturalWidths.reduce((sum, w) => sum + w, 0);

  let colWidths: number[];
  if (totalNatural <= budget) {
    colWidths = [...naturalWidths];
  } else {
    // 先保证不可断词的最小宽度；仍超预算时按比例压缩，再按剩余空间回填
    let widths = [...minWidths];
    let totalMin = widths.reduce((sum, w) => sum + w, 0);
    if (totalMin > budget) {
      widths = widths.map((w) => Math.max(1, Math.floor((w * budget) / totalMin)));
      let sum = widths.reduce((a, b) => a + b, 0);
      while (sum > budget) {
        let idx = 0;
        for (let i = 1; i < colCount; i++) {
          if (widths[i] > widths[idx] && widths[i] > 1) idx = i;
        }
        if (widths[idx] <= 1) break;
        widths[idx] -= 1;
        sum -= 1;
      }
      while (sum < budget) {
        widths[sum % colCount] += 1;
        sum += 1;
      }
    } else {
      let remaining = budget - totalMin;
      const wants = naturalWidths.map((natural, i) => Math.max(0, natural - widths[i]));
      const totalWant = wants.reduce((sum, want) => sum + want, 0);
      if (totalWant > 0 && remaining > 0) {
        // 按未满足宽度比例分配，避免长文本列独吞空间把短列压成逐字换行
        for (let i = 0; i < colCount; i++) {
          const share = Math.floor((wants[i] * remaining) / totalWant);
          widths[i] += Math.min(share, wants[i]);
        }
        let used = widths.reduce((sum, w) => sum + w, 0);
        remaining = budget - used;
      }
      while (remaining > 0) {
        let idx = -1;
        let best = 0;
        for (let i = 0; i < colCount; i++) {
          const unmet = naturalWidths[i] - widths[i];
          if (unmet > best) {
            best = unmet;
            idx = i;
          }
        }
        if (idx < 0) break;
        widths[idx] += 1;
        remaining -= 1;
      }
    }
    colWidths = widths;
  }

  const alignments: TableAlignment[] = Array.from({ length: colCount }, (_, c) => {
    const explicit = table.alignments?.[c];
    if (explicit) return explicit;
    return inferTableAlignment(rows.map((row) => row[c] ?? ""));
  });

  const lines: string[] = [];

  const borderLine = (left: string, mid: string, right: string): string => {
    let line = left;
    for (let c = 0; c < colCount; c++) {
      line += "─".repeat(colWidths[c] + 2);
      line += c < colCount - 1 ? mid : right;
    }
    return S.d(line);
  };

  const contentLines = (cells: string[], header = false): string[] => {
    const wrapped = cells.map((cell, c) => wrapTableCell(cell || "", colWidths[c]));
    const height = Math.max(1, ...wrapped.map((cellLines) => cellLines.length));
    const output: string[] = [];
    for (let line = 0; line < height; line++) {
      let row = S.d("│");
      for (let c = 0; c < colCount; c++) {
        const text = padTableCell(
          wrapped[c]?.[line] ?? "",
          colWidths[c],
          alignments[c]
        );
        row += " " + (header ? BOLD(S.b(text)) : S.b(text)) + " " + S.d("│");
      }
      output.push(row);
    }
    return output;
  };

  // top border
  lines.push(borderLine("┌", "┬", "┐"));

  // header
  lines.push(...contentLines(headers, true));

  // separator
  lines.push(borderLine("├", "┼", "┤"));

  // rows
  for (let r = 0; r < rows.length; r++) {
    lines.push(...contentLines(rows[r] ?? [], false));
    if (r < rows.length - 1) {
      lines.push(borderLine("├", "┼", "┤"));
    }
  }

  // bottom border
  lines.push(borderLine("└", "┴", "┘"));

  return lines;
}

function renderInline(text: string): string {
  let res = text;
  // 先保护内联代码：`open_binary` 里的下划线不能再被斜体规则吃掉
  const codeSpans: string[] = [];
  res = res.replace(/`([^`]+)`/g, (_match, p1: string) => {
    const index = codeSpans.length;
    codeSpans.push(S.s(p1));
    return `\u0000${index}\u0000`;
  });
  // 加粗 **bold** / __bold__
  res = res.replace(/\*\*(.+?)\*\*/g, (_, p1) => BOLD(p1));
  res = res.replace(/__(.+?)__/g, (_, p1) => BOLD(p1));
  // 删除线 ~~strike~~
  res = res.replace(/~~(.+?)~~/g, (_, p1) => DIM(p1));
  // 斜体 *italic* / _italic_（避开已处理的 ** / __，并要求下划线边界）
  res = res.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_, p1) => `\x1b[3m${p1}\x1b[0m`);
  res = res.replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, (_, p1) => `\x1b[3m${p1}\x1b[0m`);
  // 链接 [text](url)
  res = res.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, p1, p2) => `${p1} ${S.d("(" + p2 + ")")}`);
  // 还原内联代码
  res = res.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => codeSpans[Number(index)] ?? "");
  return res;
}

/** 是否像 Markdown（决定工具输出是否走渲染，避免 JSON 被误伤） */
export function looksLikeMarkdown(text: string): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  if (/```/.test(t)) return true;
  if (/^#{1,6}\s+\S/m.test(t)) return true;
  if (/\|\s*.+\s*\|/.test(t) && /\|?\s*:?-{3,}/.test(t)) return true;
  if (/\*\*[^*]+\*\*/.test(t)) return true;
  if (/^\s*[-*+]\s+\S/m.test(t)) return true;
  if (/^\s*\d+\.\s+\S/m.test(t)) return true;
  if (/^\s*>\s+\S/m.test(t)) return true;
  if (/^\s*[-*+]\s+\[[ xX]\]\s+/m.test(t)) return true;
  if (/^\s*[-*_]{3,}\s*$/m.test(t)) return true;
  if (/\[[^\]]+\]\([^)]+\)/.test(t)) return true;
  return false;
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
      const span = Math.max(10, width - 4);
      if (!inCodeBlock) {
        const rawLang = line.trim().slice(3).trim();
        if (rawLang && sw(rawLang) + 4 < span) {
          const fill = Math.max(2, span - sw(rawLang) - 3);
          resultLines.push(DIM(`  ┌─ ${rawLang} ${"─".repeat(fill)}`));
        } else {
          resultLines.push(DIM(`  ┌${"─".repeat(span)}`));
        }
        inCodeBlock = true;
      } else {
        resultLines.push(DIM(`  └${"─".repeat(span)}`));
        inCodeBlock = false;
      }
      i++;
      continue;
    }

    // 2. 如果在代码块内部 (P1: 长行避免信息墙 + 宽字符)
    if (inCodeBlock) {
      const maxCode = Math.max(10, width - 6);
      let codeLine = line;
      if (sw(line) > maxCode) {
        // local truncate using string-width
        let col = 0, idx = 0;
        for (const ch of Array.from(line)) {
          const w = sw(ch);
          if (col + w > maxCode - 1) break;
          col += w; idx += ch.length;
        }
        codeLine = line.slice(0, idx) + "…";
      }
      resultLines.push("  " + S.s(codeLine));
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
      resultLines.push(...wrapVisibleText(renderInline(content), width).map((wrapped) => S.p(BOLD(wrapped))));
      resultLines.push("");
      i++;
      continue;
    }

    // 5. 任务列表 - [ ] / - [x]（须在无序列表之前）
    const taskMatch = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (taskMatch) {
      const indent = taskMatch[1] || "";
      const checked = taskMatch[2].trim().toLowerCase() === "x" ? "☑" : "☐";
      const content = taskMatch[3] || "";
      const firstPrefix = indent + `  ${checked} `;
      const restPrefix = indent + "    ";
      resultLines.push(...wrapVisibleText(renderInline(content), width, firstPrefix, restPrefix));
      i++;
      continue;
    }

    // 6. 无序列表
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ulMatch) {
      const indent = ulMatch[1] || "";
      const content = ulMatch[2] || "";
      const firstPrefix = indent + "  • ";
      const restPrefix = indent + "    ";
      resultLines.push(...wrapVisibleText(renderInline(content), width, firstPrefix, restPrefix));
      i++;
      continue;
    }

    // 7. 有序列表
    const olMatch = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
    if (olMatch) {
      const indent = olMatch[1] || "";
      const num = olMatch[2] || "";
      const content = olMatch[3] || "";
      const firstPrefix = indent + "  " + num + " ";
      const restPrefix = indent + " ".repeat(sw("  " + num + " "));
      resultLines.push(...wrapVisibleText(renderInline(content), width, firstPrefix, restPrefix));
      i++;
      continue;
    }

    // 8. 引用块 >
    const quoteMatch = line.match(/^(\s*)>\s?(.*)$/);
    if (quoteMatch) {
      const indent = quoteMatch[1] || "";
      const content = quoteMatch[2] || "";
      const prefix = indent + "  > ";
      resultLines.push(...wrapVisibleText(renderInline(content), width, prefix, prefix).map((l) => S.s(l)));
      i++;
      continue;
    }

    // 9. 水平分割线 ---
    if (/^ {0,3}[-*_]{3,}\s*$/.test(line)) {
      const hr = "─".repeat(Math.max(10, Math.min(60, width - 4)));
      resultLines.push(DIM("  " + hr));
      i++;
      continue;
    }

    // 10. 普通行
    resultLines.push(...wrapVisibleText(renderInline(line), width));
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
