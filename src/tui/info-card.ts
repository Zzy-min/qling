// ============================================================
// 终端信息卡：对标 Grok build 的 rounded panel
// - 圆角边框、标题在顶边、标签列对齐、值列自动换行
// - 纯文本行，可由 markdown/notice 通道原样输出
// ============================================================

import stringWidth from "string-width";

export interface InfoCardRow {
  label: string;
  value: string;
}

export interface InfoCardOptions {
  title: string;
  subtitle?: string;
  rows: InfoCardRow[];
  footer?: string | string[];
  width?: number;
}

function sliceToWidth(value: string, width: number): string {
  if (width <= 0) return "";
  if (stringWidth(value) <= width) return value;
  let out = "";
  let used = 0;
  for (const char of value) {
    const next = stringWidth(char);
    if (used + next > width - 1) break;
    out += char;
    used += next;
  }
  return `${out}…`;
}

function padToWidth(value: string, width: number): string {
  const used = stringWidth(value);
  return used >= width ? value : value + " ".repeat(width - used);
}

/** 按显示宽度换行；中文逐字可断，英文单词尽量保持完整。 */
function wrapValue(value: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  if (!value) return [""];
  const tokens = value.match(/[\u4e00-\u9fff\u3000-\u303f]|[^\s\u4e00-\u9fff\u3000-\u303f]+|\s+/g) ?? [value];
  const lines: string[] = [];
  let current = "";
  let used = 0;

  const flush = (): void => {
    if (current.trim()) lines.push(current.trimEnd());
    current = "";
    used = 0;
  };

  for (const token of tokens) {
    const tokenWidth = stringWidth(token);
    if (used + tokenWidth <= safeWidth) {
      current += token;
      used += tokenWidth;
      continue;
    }
    flush();
    if (/^\s+$/.test(token)) continue;
    if (tokenWidth <= safeWidth) {
      current = token;
      used = tokenWidth;
      continue;
    }
    for (const char of token) {
      const charWidth = Math.max(1, stringWidth(char));
      if (used + charWidth > safeWidth && used > 0) flush();
      current += char;
      used += charWidth;
    }
  }
  flush();
  return lines.length > 0 ? lines : [""];
}

/** 生成等宽、圆角的信息卡；所有行可见宽度一致。 */
export function formatInfoCard(options: InfoCardOptions): string[] {
  const width = Math.max(36, Math.min(96, Math.floor(options.width ?? 80)));
  const inner = width - 2;
  const labels = options.rows.map((row) => row.label);
  const labelWidth = Math.min(
    Math.max(...labels.map((label) => stringWidth(label)), 8),
    Math.max(8, Math.floor(inner / 3))
  );
  const valueWidth = Math.max(8, width - labelWidth - 7);

  const heading = options.subtitle
    ? `${options.title} · ${options.subtitle}`
    : options.title;
  const topPrefix = "╭─ ";
  const topSuffix = " ╮";
  const safeHeading = sliceToWidth(heading, Math.max(1, width - 8));
  const topDashes = Math.max(1, width - 6 - stringWidth(safeHeading));
  const top = `${topPrefix}${safeHeading} ${"─".repeat(topDashes)}${topSuffix}`;

  const lines: string[] = [padToWidth(top, width)];
  for (const row of options.rows) {
    const wrapped = wrapValue(row.value, valueWidth);
    const label = sliceToWidth(row.label, labelWidth);
    for (let index = 0; index < wrapped.length; index++) {
      const left = index === 0 ? padToWidth(label, labelWidth) : " ".repeat(labelWidth);
      const right = padToWidth(wrapped[index] ?? "", valueWidth);
      lines.push(`│ ${left}   ${right} │`);
    }
  }
  if (options.footer) {
    const footers = Array.isArray(options.footer)
      ? options.footer
      : [options.footer];
    for (const entry of footers) {
      for (const footer of wrapValue(entry, inner - 2)) {
        lines.push(`│ ${padToWidth(footer, inner - 2)} │`);
      }
    }
  }
  lines.push(`╰${"─".repeat(width - 2)}╯`);
  return lines.map((line) => padToWidth(line, width));
}

/**
 * 兼容旧命令的扁平面板：
 *   📊 【标题】
 *   -----------------------------
 *   标签 : 值
 *   -----------------------------
 * 自动升级为圆角信息卡；不符合键值结构的报告（如 /help 指令表）保持原样。
 */
export function formatFlatInfoPanels(text: string, width = 76): string {
  if (width < 40) return text;
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const separator = /^\s*-{20,}\s*$/;
  const kv = /^\s*([^:：]{1,24}?)\s*[:：]\s*(.+?)\s*$/;
  const out: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (!separator.test(line)) {
      out.push(line);
      continue;
    }

    let titleIndex = index - 1;
    while (titleIndex >= 0 && !(lines[titleIndex] ?? "").trim()) titleIndex--;
    const titleLine = (lines[titleIndex] ?? "").trim();
    if (!titleLine || /[:：]/.test(titleLine) || separator.test(titleLine)) {
      out.push(line);
      continue;
    }

    let end = index + 1;
    while (end < lines.length && !separator.test(lines[end] ?? "")) end++;
    if (end >= lines.length) {
      out.push(line);
      continue;
    }

    const body = lines.slice(index + 1, end).filter((entry) => entry.trim().length > 0);
    const rows: InfoCardRow[] = [];
    let convertible = body.length > 0;
    for (const entry of body) {
      const match = entry.match(kv);
      if (!match || /^[-*•]/.test(entry.trim())) {
        convertible = false;
        break;
      }
      rows.push({ label: (match[1] ?? "").trim(), value: (match[2] ?? "").trim() });
    }
    if (!convertible || rows.length < 2) {
      out.push(line);
      continue;
    }

    // 移除标题前的空行，用卡片替换“标题 + 分隔线 + 键值 + 分隔线”
    out.length = Math.max(0, titleIndex);
    const heading = titleLine.replace(/^([^\s【]+)\s*【(.+)】$/, "$1 $2").replace(/^【|】$/g, "");
    const footer: string[] = [];
    let cursor = end + 1;
    while (
      cursor < lines.length &&
      footer.length < 4 &&
      (lines[cursor] ?? "").trim() &&
      !separator.test(lines[cursor] ?? "") &&
      !/^[╭│╰]/.test((lines[cursor] ?? "").trim())
    ) {
      footer.push((lines[cursor] ?? "").trim());
      cursor++;
    }
    out.push(...formatInfoCard({ title: heading, rows, ...(footer.length > 0 ? { footer } : {}), width }));
    if (lines[cursor]?.trim() === "" && out[out.length - 1] !== "") out.push("");
    index = footer.length > 0 ? cursor - 1 : end;
  }

  return out.join("\n");
}
