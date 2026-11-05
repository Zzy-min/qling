// ============================================================
// overlay-panel — TUI 浮层面板（会话切换 / 轮次浏览 / 命令选择）
// ============================================================

import { bgKey, getBorderChars, inverseFgKey, paint } from "./theme.js";
import { padVisible, truncateVisible, visibleWidth } from "./shell.js";
import {
  FLEET_EMPTY_HINT,
  FLEET_PANEL_TITLE,
  buildSessionFleetRow,
  type SessionFleetInput,
} from "./session-fleet.js";

export interface SessionPickerItem {
  sessionId: string;
  name: string;
  updatedAt: string;
  turnCount: number;
  messageCount: number;
  sessionTokens?: number;
  workspaceDir?: string | null;
  active?: boolean;
}

export interface TurnBrowseItem {
  index: number;
  preview: string;
}

export interface ScrollbackViewportPanelSnapshot {
  turnIndex: number;
  turnCount: number;
  page: number;
  pageCount: number;
  lines: string[];
}

/** 通用选项切换器条目（model / theme / sandbox / mode …） */
export interface OptionPickerItem {
  id: string;
  label: string;
  description?: string;
  active?: boolean;
  /** Grok slash_dropdown 的 `[tag]`：分类徽标（如 常用 / Git / 记忆）。 */
  tag?: string;
  /** 右对齐元信息：参数提示、别名或快捷键（如 `<path>`）。 */
  hint?: string;
  /** 别名（不直接显示，用于 /exit 这类检索）。 */
  aliases?: string[];
  /** 不可选提示行（如「无匹配」）；不参与导航与确认。 */
  disabled?: boolean;
  /** 非可选分组标题（Grok picker section header）。 */
  section?: boolean;
  /** 分组可折叠；点击标题或 Enter 切换。 */
  collapsible?: boolean;
  /** 当前是否收起。 */
  collapsed?: boolean;
  /** 分组内条目总数，用于折叠标题显示。 */
  sectionCount?: number;
}

export interface OptionPickerSpec {
  title: string;
  items: OptionPickerItem[];
  /** 初始选中 id；缺省取 active 或 0 */
  selectedId?: string;
  footerHint?: string;
  /** 分组标题默认收起（如命令切换器的「高级」）。 */
  defaultCollapsed?: string[];
  /**
   * true：斜杠命令切换器 — 保留输入区 `/` 前缀，键入时过滤列表
   */
  filterable?: boolean;
  onPick: (item: OptionPickerItem) => void | Promise<void>;
  /**
   * Esc / Ctrl+C / Ctrl+D 取消浮层时调用（确认选择不会触发）。
   * 用于审批面板将取消映射为 deny。
   */
  onDismiss?: () => void;
  /**
   * 非 filterable 时：可打印键 → 条目 id（如 a→allow_once）。
   * 命中后等价于选中该条目并确认。
   */
  shortcuts?: Record<string, string>;
}

export interface OptionPickerLayout {
  terminalRows?: number;
  inputRows?: number;
  statusRows?: number;
}

export interface OptionPickerPanelRender {
  lines: string[];
  /** 面板行(含上下边框) → 条目下标；用于鼠标命中。 */
  rowItems: Array<number | null>;
  /** 滚动条元信息：用于点击/拖动定位。 */
  scrollbar?: {
    totalItems: number;
    viewportItems: number;
    topLine: number;
    bottomLine: number;
  };
}

/** Panel width is capped at 100 cells; the same inner width drives every row. */
function pickerInnerWidth(width: number): number {
  return Math.max(20, Math.min(width, 100) - 4);
}

/** Keep the first hint plus the highest-value trailing keys when width is tight. */
function fitFooter(footer: string, width: number): string {
  if (visibleWidth(footer) <= width) return footer;
  const parts = footer.split(" · ").filter(Boolean);
  if (parts.length <= 1) return truncateVisible(footer, width);
  const isCount = (part: string): boolean =>
    /^(共|浏览全部)\s*\d+\s*(条|项)/.test(part) || /^\d+\/\d+$/.test(part);
  const score = (part: string): number => {
    if (/↑\/↓|Enter|Esc/.test(part)) return 1;
    if (/PgUp|PgDn|Tab|Shift\+/.test(part)) return 2;
    if (isCount(part)) return 9;
    return 3;
  };
  const priority = [
    0,
    ...parts
      .map((_, i) => i)
      .filter((i) => i > 0)
      .sort((a, b) => score(parts[a]!) - score(parts[b]!) || b - a),
  ];
  const keep = new Set<number>();
  for (const idx of priority) {
    keep.add(idx);
    const candidate = parts.filter((_, i) => keep.has(i)).join(" · ");
    if (visibleWidth(candidate) > width) keep.delete(idx);
  }
  if (keep.size === 0) return truncateVisible(footer, width);
  return truncateVisible(
    parts.filter((_, i) => keep.has(i)).join(" · "),
    width
  );
}

function frameLines(
  title: string,
  body: string[],
  width: number,
  footer: string
): string[] {
  const b = getBorderChars();
  const w = Math.max(40, Math.min(width, 100));
  const inner = pickerInnerWidth(width);
  const titleText = truncateVisible(` ${title} `, Math.max(4, w - 4));
  const dashAfter = Math.max(1, inner + 2 - 1 - visibleWidth(titleText));
  const top = `${b.tl}${b.h}${titleText}${b.h.repeat(dashAfter)}${b.tr}`;
  const lines = body.map((line) => {
    const text = truncateVisible(line, inner);
    return `${b.v} ${padVisible(text, inner)} ${b.v}`;
  });
  const foot = fitFooter(footer, inner);
  const footLine = `${b.v} ${padVisible(foot, inner)} ${b.v}`;
  const bottom = `${b.bl}${b.h.repeat(inner + 2)}${b.br}`;
  return [top, ...lines, footLine, bottom];
}

/** Highlight hotkeys inside the footer so actions scan faster than prose. */
const PICKER_HOTKEY_RE =
  /(↑\/↓|Shift\+↑↓|PgUp\/PgDn|Enter\/Space|Enter|Esc|Tab 补全|Tab|Ctrl\+[A-Z])/;

function paintPickerFooter(line: string): string {
  const prefix = line.slice(0, 2);
  const suffix = line.slice(-2);
  const inner = line.slice(2, -2);
  const parts = inner.split(/(·)/);
  const text = parts
    .map((part) => {
      if (part === "·") return paint.dim(part);
      let out = "";
      let last = 0;
      for (const match of part.matchAll(
        new RegExp(PICKER_HOTKEY_RE.source, "g")
      )) {
        const start = match.index ?? 0;
        if (start > last) out += paint.secondary(part.slice(last, start));
        out += paint.bright(match[0]);
        last = start + match[0].length;
      }
      if (last < part.length) out += paint.secondary(part.slice(last));
      return out;
    })
    .join("");
  return paint.dim(prefix) + text + paint.dim(suffix);
}

/** Grok fuzzy_accent + [tag]：高亮查询命中与分类徽标。 */
function paintPickerBodyText(
  text: string,
  query: string | undefined,
  base: (s: string) => string,
  accent: (s: string) => string,
  tagAccent: (s: string) => string
): string {
  const ranges: Array<{
    start: number;
    end: number;
    priority: number;
    paint: (s: string) => string;
  }> = [];
  // 徽标优先展示，查询命中再覆盖（priority 更高）。
  for (const match of text.matchAll(/\[[^\]\n]{1,20}\]/g)) {
    const start = match.index ?? 0;
    ranges.push({
      start,
      end: start + match[0].length,
      priority: 1,
      paint: tagAccent,
    });
  }
  const raw = (query ?? "").trim();
  if (raw && raw !== "/") {
    const terms = Array.from(
      new Set(
        raw
          .toLowerCase()
          .split(/\s+/)
          .map((term) => term.replace(/^\/+/, ""))
          .filter((term) => term.length >= 2)
      )
    ).slice(0, 4);
    const lower = text.toLowerCase();
    for (const term of terms) {
      let from = 0;
      let contiguous = false;
      while (ranges.length < 24) {
        const at = lower.indexOf(term, from);
        if (at < 0) break;
        ranges.push({
          start: at,
          end: at + term.length,
          priority: 2,
          paint: accent,
        });
        contiguous = true;
        from = at + term.length;
      }
      // 子序列命中（thm → /theme）：逐字符着色，对标 Grok index highlight
      if (!contiguous && term.length >= 3) {
        const points: number[] = [];
        let cursor = 0;
        for (const ch of term) {
          const at = lower.indexOf(ch, cursor);
          if (at < 0) {
            points.length = 0;
            break;
          }
          points.push(at);
          cursor = at + 1;
        }
        for (const at of points.slice(0, 12)) {
          ranges.push({ start: at, end: at + 1, priority: 2, paint: accent });
        }
      }
    }
  }
  if (ranges.length === 0) return base(text);

  const bounds = Array.from(
    new Set([
      0,
      text.length,
      ...ranges.flatMap((range) => [range.start, range.end]),
    ])
  )
    .filter((at) => at >= 0 && at <= text.length)
    .sort((a, b) => a - b);
  let out = "";
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i]!;
    const end = bounds[i + 1]!;
    if (end <= start) continue;
    let chosen: { priority: number; paint: (s: string) => string } | null =
      null;
    for (const range of ranges) {
      if (range.start <= start && range.end >= end) {
        if (!chosen || range.priority > chosen.priority) chosen = range;
      }
    }
    out += chosen
      ? chosen.paint(text.slice(start, end))
      : base(text.slice(start, end));
  }
  return out;
}

interface PickerPaintOptions {
  isSelected: (line: string) => boolean;
  isActive?: (line: string) => boolean;
  isDisabled?: (line: string) => boolean;
  isHovered?: (row: number) => boolean;
  query?: string;
}

/** Shared picker frame coloring: selected rows become a full-width inverse bar. */
function paintPickerLines(lines: string[], options: PickerPaintOptions): string {
  const { isSelected, isActive, isDisabled, isHovered, query } = options;
  const paintBody = (
    line: string,
    base: (s: string) => string,
    accent: (s: string) => string
  ): string => {
    const prefix = line.slice(0, 2);
    const suffix = line.slice(-2);
    const inner = line.slice(2, -2);
    const marker = inner.slice(-1);
    const hasScrollbar = marker === "█" || marker === "▏";
    const text = hasScrollbar ? inner.slice(0, -1) : inner;
    const scrollbarCell =
      marker === "█"
        ? bgKey("scrollbarThumb", "█")
        : marker === "▏"
          ? bgKey("scrollbarTrack", " ")
          : "";
    return (
      base(prefix) +
      paintPickerBodyText(text, query, base, accent, paint.magenta) +
      scrollbarCell +
      base(suffix)
    );
  };
  return lines
    .map((line, idx) => {
      if (idx === 0) return paint.primary(line);
      if (idx === lines.length - 1) return paint.dim(line);
      if (idx === lines.length - 2) return paintPickerFooter(line);
      if (isSelected(line)) {
        const prefix = line.slice(0, 2);
        const suffix = line.slice(-2);
        const inner = line.slice(2, -2);
        const marker = inner.slice(-1);
        const hasScrollbar = marker === "█" || marker === "▏";
        const text = hasScrollbar ? inner.slice(0, -1) : inner;
        const scrollbarCell =
          marker === "█"
            ? bgKey("scrollbarThumb", "█")
            : marker === "▏"
              ? bgKey("scrollbarTrack", " ")
              : "";
        return (
          paint.primary(prefix) +
          inverseFgKey("secondary", text) +
          scrollbarCell +
          paint.primary(suffix)
        );
      }
      if (isDisabled?.(line)) return paintBody(line, paint.dim, paint.dim);
      if (isHovered?.(idx)) return paintBody(line, paint.primary, paint.bright);
      if (isActive?.(line)) return paintBody(line, paint.secondary, paint.bright);
      return paintBody(line, paint.dim, paint.primary);
    })
    .join("\n");
}

/**
 * 可视窗口大小：只限制「一屏画几行」，不截断数据源。
 * 全部会话仍在 items 里，↑/↓ 滑动窗口浏览。
 */
const SESSION_PICKER_WINDOW = 12;

/**
 * 会话舰队面板（G4 · 对标 Grok Agent Dashboard 行可扫性）。
 * 无 ANSI，便于测宽；着色在 TUI 层。
 */
export function renderSessionPickerPanel(
  items: SessionPickerItem[],
  selected: number,
  width = 80,
  nowMs: number = Date.now()
): OptionPickerPanelRender {
  const body: string[] = [];
  const rowItems: Array<number | null> = [];
  let scrollbarMeta: OptionPickerPanelRender["scrollbar"];
  const pushRow = (line: string, target: number | null = null): void => {
    body.push(line);
    rowItems.push(target);
  };
  const inner = pickerInnerWidth(width);
  if (items.length === 0) {
    pushRow(FLEET_EMPTY_HINT);
  } else {
    const n = items.length;
    const win = Math.min(SESSION_PICKER_WINDOW, n);
    const start = Math.max(
      0,
      Math.min(selected - Math.floor(win / 2), n - win)
    );
    const end = start + win;
    for (let i = start; i < end; i++) {
      const item = items[i]!;
      const fleet = buildSessionFleetRow(item as SessionFleetInput, nowMs);
      const mark = i === selected ? "▸" : " ";
      pushRow(truncateVisible(`${mark} ${fleet.primaryLabel}`, inner), i);
      pushRow(truncateVisible(`   ${fleet.secondaryLine}`, inner), i);
    }
    if (n > win) {
      applyOptionPickerScrollbar(body, inner, n, win, start);
      scrollbarMeta = {
        totalItems: n,
        viewportItems: win,
        topLine: 1,
        bottomLine: body.length,
      };
    }
  }
  const n = items.length;
  const footer =
    n > SESSION_PICKER_WINDOW
      ? `↑/↓ 浏览全部 ${n} 条 · Enter 恢复 · Esc 取消 · /dashboard web`
      : n === 0
        ? `Esc 关闭 · 输入消息开始 · /dashboard web 开任务台`
        : `↑/↓ 选择 · Enter 恢复 · Esc 取消 · 共 ${n} 条 · /dashboard web`;
  const lines = frameLines(`${FLEET_PANEL_TITLE} · ${n} 条`, body, width, footer);
  return {
    lines,
    rowItems: [null, ...rowItems, null, null],
    scrollbar: scrollbarMeta,
  };
}

export function formatSessionPickerPanel(
  items: SessionPickerItem[],
  selected: number,
  width = 80,
  nowMs: number = Date.now()
): string[] {
  return renderSessionPickerPanel(items, selected, width, nowMs).lines;
}

export function paintSessionPickerPanel(
  lines: string[],
  _selected: number,
  hoverRows?: Set<number>
): string {
  // 选中行由 format 写入 ▸；滑动窗口下不能用全局 selected 下标映射
  return paintPickerLines(lines, {
    isSelected: (line) => line.includes("▸"),
    isActive: (line) => line.includes("●"),
    isHovered: hoverRows ? (row) => hoverRows.has(row) : undefined,
  });
}

export function formatTurnBrowsePanel(
  items: TurnBrowseItem[],
  selected: number,
  width = 80
): string[] {
  const body: string[] = [];
  if (items.length === 0) {
    body.push("(尚无用户轮次 — 先发一条消息)");
  } else {
    const inner = pickerInnerWidth(width);
    items.forEach((item, i) => {
      const mark = i === selected ? "▸" : " ";
      body.push(
        truncateVisible(`${mark} #${item.index + 1}  ${item.preview}`, inner)
      );
    });
  }
  return frameLines(
    `轮次浏览 · Scrollback · ${items.length} 轮`,
    body,
    width,
    "PgUp/PgDn 或 Shift+↑↓ · Enter/Space 回输入 · Esc 关闭"
  );
}

export function paintTurnBrowsePanel(
  lines: string[],
  _selected: number
): string {
  return paintPickerLines(lines, {
    isSelected: (line) => line.includes("▸"),
  });
}

export function formatScrollbackViewportPanel(
  snapshot: ScrollbackViewportPanelSnapshot,
  width = 80
): string[] {
  const turnLabel =
    snapshot.turnIndex >= 0
      ? `轮次 ${snapshot.turnIndex + 1}/${Math.max(1, snapshot.turnCount)}`
      : "暂无轮次";
  const pageLabel = `页 ${snapshot.page}/${snapshot.pageCount}`;
  const body =
    snapshot.lines.length > 0 ? snapshot.lines : ["(该页暂无内容)"];
  return frameLines(
    `Scrollback · ${turnLabel} · ${pageLabel}`,
    body,
    width,
    "↑/↓ 或 Shift+↑/↓ 切轮 · PgUp/PgDn 翻页 · Enter/Space 回输入"
  );
}

export function paintScrollbackViewportPanel(lines: string[]): string {
  return lines
    .map((line, idx) => {
      if (idx === 0) return paint.primary(line);
      if (idx === lines.length - 1) return paint.dim(line);
      if (idx === lines.length - 2) return paint.secondary(line);
      if (line.includes("【你】")) return paint.secondary(line);
      if (line.includes("【轻灵】")) return paint.bright(line);
      return paint.dim(line);
    })
    .join("\n");
}

const OPTION_PICKER_WINDOW = 12;

function resolveOptionPickerWindow(
  items: OptionPickerItem[],
  layout?: OptionPickerLayout
): { windowSize: number; padDescriptions: boolean } {
  const padDescriptions = items.some((item) => Boolean(item.description));
  if (!layout?.terminalRows) {
    return {
      windowSize: Math.min(OPTION_PICKER_WINDOW, items.length),
      padDescriptions: false,
    };
  }
  const inputRows = Math.max(1, layout.inputRows ?? 1);
  const statusRows = Math.max(0, layout.statusRows ?? 0);
  const panelRows = Math.max(
    6,
    layout.terminalRows - inputRows - statusRows - 2
  );
  const bodyRows = Math.max(1, panelRows - 3);
  // 滚动条不占用正文行（替代 ▲/▼ 文本提示）
  const sectionRows = Math.min(
    items.filter((item) => item.section).length,
    4
  );
  // 分组浏览（Grok palette）用单行紧凑布局；搜索结果仍保留两行描述。
  const itemRows = items.some((item) => item.section)
    ? 1
    : padDescriptions
      ? 2
      : 1;
  const windowSize = Math.max(
    1,
    Math.min(
      OPTION_PICKER_WINDOW,
      items.length,
      Math.floor((bodyRows - sectionRows) / itemRows)
    )
  );
  return { windowSize, padDescriptions };
}

/** 用比例滚动条替代 ▲/▼ 文本提示（Grok render_scrollbar_styled 语义）。 */
function applyOptionPickerScrollbar(
  body: string[],
  inner: number,
  totalItems: number,
  viewportItems: number,
  offsetItems: number
): void {
  if (body.length === 0 || totalItems <= viewportItems) return;
  const contentWidth = Math.max(1, inner - 2);
  const rows = body.length;
  const thumbLen = Math.max(
    1,
    Math.min(
      rows,
      Math.round((rows * viewportItems) / Math.max(1, totalItems))
    )
  );
  const maxThumbStart = Math.max(0, rows - thumbLen);
  const maxOffset = Math.max(1, totalItems - viewportItems);
  const clampedOffset = Math.max(0, Math.min(maxOffset, offsetItems));
  const thumbStart = Math.round((maxThumbStart * clampedOffset) / maxOffset);
  for (let row = 0; row < rows; row++) {
    const glyph =
      row >= thumbStart && row < thumbStart + thumbLen ? "█" : "▏";
    body[row] =
      padVisible(truncateVisible(body[row] ?? "", contentWidth), contentWidth) +
      " " +
      glyph;
  }
}

/**
 * 通用选项切换器：滑动窗口 + 恒定高度 + 比例滚动条。
 * 标题显示可执行项数量，便于过滤时确认结果范围。
 */
export function renderOptionPickerPanel(
  title: string,
  items: OptionPickerItem[],
  selected: number,
  width = 80,
  footerHint?: string,
  layout?: OptionPickerLayout
): OptionPickerPanelRender {
  const body: string[] = [];
  const rowItems: Array<number | null> = [];
  let scrollbarMeta: OptionPickerPanelRender["scrollbar"];
  const pushRow = (line: string, target: number | null = null): void => {
    body.push(line);
    rowItems.push(target);
  };
  const inner = pickerInnerWidth(width);
  const selectableCount = items.filter(
    (item) => Boolean(item.id) && !item.disabled && !item.section
  ).length;
  if (items.length === 0) {
    pushRow("(无可选项)");
  } else {
    const n = items.length;
    const { windowSize: win, padDescriptions } = resolveOptionPickerWindow(
      items,
      layout
    );
    const start = Math.max(
      0,
      Math.min(selected - Math.floor(win / 2), n - win)
    );
    const end = start + win;
    const overflow = n > win;
    // 滚动条预留 2 列（gap + track）；分组标题的横线也按内容宽度收尾
    const bodyContentWidth = overflow ? inner - 2 : inner;
    const rowWidth = bodyContentWidth;
    const hasSections = items.some((item) => item.section);
    const labelText = (item: OptionPickerItem): string =>
      `${item.label}${item.active ? "  ● 当前" : ""}${
        !hasSections && item.tag ? ` [${item.tag}]` : ""
      }`;
    const visible = items.filter((item) => !item.disabled && !item.section);
    const maxLabel = visible.reduce(
      (max, item) => Math.max(max, visibleWidth(labelText(item))),
      0
    );
    const hintLimit = Math.max(8, Math.floor(inner * 0.3));
    const maxHint = visible.reduce(
      (max, item) =>
        Math.max(max, Math.min(visibleWidth(item.hint ?? ""), hintLimit)),
      0
    );
    const hintReserve = maxHint > 0 ? maxHint + 2 : 0;
    const labelCap = hasSections ? Math.max(8, Math.floor(inner * 0.6)) : 40;
    const labelCol = Math.max(
      8,
      Math.min(maxLabel, labelCap, Math.max(8, rowWidth - hintReserve))
    );
    for (let i = start; i < end; i++) {
      const item = items[i]!;
      if (item.section) {
        const fold = item.collapsed ? "▶" : "▼";
        const mark = i === selected ? "»" : fold;
        const count = item.sectionCount ? ` (${item.sectionCount})` : "";
        const head = `${mark} ${item.label}${count} `;
        pushRow(
          head +
            "─".repeat(Math.max(0, bodyContentWidth - visibleWidth(head))),
          i
        );
        continue;
      }
      if (item.disabled) {
        pushRow(truncateVisible(`  ${item.label}`, rowWidth));
        if (item.description) {
          pushRow(truncateVisible(`   ${item.description}`, rowWidth));
        }
        continue;
      }
      const mark = i === selected ? "▸" : " ";
      const left =
        `${mark} ` +
        padVisible(truncateVisible(labelText(item), labelCol), labelCol);
      const hint = truncateVisible(item.hint ?? "", hintLimit);
      let line = left;
      const desc = (item.description ?? "").replace(/\s+/g, " ").trim();
      if (hasSections) {
        // 分组浏览：单行紧凑，描述内联截断；提示列仍右对齐
        const hintReserve = hint ? visibleWidth(hint) + 2 : 0;
        const descRoom = rowWidth - visibleWidth(left) - hintReserve - 2;
        if (desc && descRoom >= 12) {
          line += "  " + truncateVisible(desc, descRoom);
        }
      }
      if (hint && visibleWidth(line) + 2 + visibleWidth(hint) <= rowWidth) {
        line =
          line +
          " ".repeat(rowWidth - visibleWidth(line) - visibleWidth(hint)) +
          hint;
      }
      pushRow(truncateVisible(line, rowWidth), i);
      if (!hasSections && (item.description || padDescriptions)) {
        pushRow(truncateVisible(`   ${item.description ?? ""}`, rowWidth), i);
      }
    }
    if (overflow) {
      applyOptionPickerScrollbar(body, inner, n, win, start);
      scrollbarMeta = {
        totalItems: n,
        viewportItems: win,
        topLine: 1,
        bottomLine: body.length,
      };
    }
  }
  const n = items.length;
  const footer =
    footerHint ||
    (n > OPTION_PICKER_WINDOW
      ? `↑/↓ 浏览全部 ${selectableCount} 条 · Enter 确认 · Esc 取消`
      : `↑/↓ 选择 · Enter 确认 · Esc 取消 · 共 ${selectableCount} 条`);
  const lines = frameLines(
    `${title} · ${selectableCount} 项`,
    body,
    width,
    footer
  );
  return {
    lines,
    rowItems: [null, ...rowItems, null, null],
    scrollbar: scrollbarMeta,
  };
}

export function formatOptionPickerPanel(
  title: string,
  items: OptionPickerItem[],
  selected: number,
  width = 80,
  footerHint?: string,
  layout?: OptionPickerLayout
): string[] {
  return renderOptionPickerPanel(
    title,
    items,
    selected,
    width,
    footerHint,
    layout
  ).lines;
}

export function paintOptionPickerPanel(
  lines: string[],
  query?: string,
  hoverRows?: Set<number>
): string {
  return paintPickerLines(lines, {
    isSelected: (line) => line.includes("▸") || line.includes("»"),
    isActive: (line) => line.includes("●"),
    isDisabled: (line) =>
      line.includes("(无匹配)") ||
      line.includes("(无可选项)") ||
      line.includes("── "),
    isHovered: hoverRows ? (row) => hoverRows.has(row) : undefined,
    query,
  });
}









