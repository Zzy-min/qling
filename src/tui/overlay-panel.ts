// ============================================================
// overlay-panel — TUI 浮层面板（会话切换 / 轮次浏览）纯函数
// ============================================================

import { getBorderChars, paint } from "./theme.js";
import { padVisible, truncateVisible, visibleWidth } from "./shell.js";

export interface SessionPickerItem {
  sessionId: string;
  name: string;
  updatedAt: string;
  turnCount: number;
  messageCount: number;
  active?: boolean;
}

export interface TurnBrowseItem {
  index: number;
  preview: string;
}

/** 通用选项切换器条目（model / theme / sandbox / mode …） */
export interface OptionPickerItem {
  id: string;
  label: string;
  description?: string;
  active?: boolean;
}

export interface OptionPickerSpec {
  title: string;
  items: OptionPickerItem[];
  /** 初始选中 id；缺省取 active 或 0 */
  selectedId?: string;
  footerHint?: string;
  onPick: (item: OptionPickerItem) => void | Promise<void>;
}

function formatUpdated(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso.slice(0, 16);
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function frameLines(title: string, body: string[], width: number, footer: string): string[] {
  const b = getBorderChars();
  const w = Math.max(40, Math.min(width, 100));
  const inner = Math.max(20, w - 4);
  const titleText = ` ${title} `;
  const dashAfter = Math.max(1, inner + 2 - 1 - visibleWidth(titleText));
  const top = `${b.tl}${b.h}${titleText}${b.h.repeat(dashAfter)}${b.tr}`;
  const lines = body.map((line) => {
    const text = truncateVisible(line, inner);
    return `${b.v} ${padVisible(text, inner)} ${b.v}`;
  });
  const foot = truncateVisible(footer, inner);
  const footLine = `${b.v} ${padVisible(foot, inner)} ${b.v}`;
  const bottom = `${b.bl}${b.h.repeat(inner + 2)}${b.br}`;
  return [top, ...lines, footLine, bottom];
}

/**
 * 可视窗口大小：只限制「一屏画几行」，不截断数据源。
 * 全部会话仍在 items 里，↑/↓ 滑动窗口浏览。
 */
const SESSION_PICKER_WINDOW = 12;

/** 会话切换器面板（无 ANSI，便于测宽；着色在 TUI 层） */
export function formatSessionPickerPanel(
  items: SessionPickerItem[],
  selected: number,
  width = 80
): string[] {
  const body: string[] = [];
  if (items.length === 0) {
    body.push("(无已保存会话)");
  } else {
    // 围绕 selected 的滑动窗口；▲/▼ 行始终占位，保证 lineCount 恒定便于原地擦除
    const n = items.length;
    const win = Math.min(SESSION_PICKER_WINDOW, n);
    const start = Math.max(0, Math.min(selected - Math.floor(win / 2), n - win));
    const end = start + win;
    const needsChrome = n > win;
    if (needsChrome) {
      body.push(
        truncateVisible(
          start > 0
            ? `   ▲ 更早 ${start} 条（共 ${n}）`
            : `   · 共 ${n} 条会话 · 向下浏览`,
          70
        )
      );
    }
    for (let i = start; i < end; i++) {
      const item = items[i]!;
      const mark = i === selected ? "▸" : " ";
      const active = item.active ? " ●" : "";
      const label = `${mark} ${item.name}${active}`;
      const meta = `${formatUpdated(item.updatedAt)} · ${item.turnCount}t · ${item.messageCount}m`;
      const id = item.sessionId.length > 18 ? item.sessionId.slice(0, 16) + "…" : item.sessionId;
      body.push(truncateVisible(`${label}`, 70));
      body.push(truncateVisible(`   ${id}  ${meta}`, 70));
    }
    if (needsChrome) {
      body.push(
        truncateVisible(
          end < n
            ? `   ▼ 更晚 ${n - end} 条 · ${selected + 1}/${n}`
            : `   · ${selected + 1}/${n} · 已到最旧`,
          70
        )
      );
    }
  }
  const n = items.length;
  const footer =
    n > SESSION_PICKER_WINDOW
      ? `↑/↓ 浏览全部 ${n} 条 · Enter 恢复 · Esc 取消 · Ctrl+\\`
      : `↑/↓ 选择 · Enter 恢复 · Esc 取消 · 共 ${n} 条`;
  return frameLines("会话切换 · Sessions", body, width, footer);
}

export function paintSessionPickerPanel(lines: string[], _selected: number): string {
  // 选中行由 format 写入 ▸；滑动窗口下不能用全局 selected 下标映射
  return lines
    .map((line, idx) => {
      if (idx === 0 || idx === lines.length - 1 || idx === lines.length - 2) {
        return paint.primary(line);
      }
      const isSelectedRow = line.includes("▸");
      return isSelectedRow ? paint.secondary(line) : paint.dim(line);
    })
    .join("\n");
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
    items.forEach((item, i) => {
      const mark = i === selected ? "▸" : " ";
      body.push(
        truncateVisible(`${mark} #${item.index + 1}  ${item.preview}`, 70)
      );
    });
  }
  return frameLines(
    "轮次浏览 · Scrollback",
    body,
    width,
    "PgUp/PgDn 或 Shift+↑↓ · Enter/Space 回输入 · Esc 关闭"
  );
}

export function paintTurnBrowsePanel(lines: string[], selected: number): string {
  return lines
    .map((line, idx) => {
      if (idx === 0 || idx === lines.length - 1 || idx === lines.length - 2) {
        return paint.primary(line);
      }
      const bodyIndex = idx - 1;
      const isSelected = bodyIndex === selected;
      return isSelected ? paint.secondary(line) : paint.dim(line);
    })
    .join("\n");
}

const OPTION_PICKER_WINDOW = 12;

/**
 * 通用选项切换器：滑动窗口 + 恒定高度（与会话切换器同构，避免叠层擦除错位）
 */
export function formatOptionPickerPanel(
  title: string,
  items: OptionPickerItem[],
  selected: number,
  width = 80,
  footerHint?: string
): string[] {
  const body: string[] = [];
  if (items.length === 0) {
    body.push("(无可选项)");
  } else {
    const n = items.length;
    const win = Math.min(OPTION_PICKER_WINDOW, n);
    const start = Math.max(0, Math.min(selected - Math.floor(win / 2), n - win));
    const end = start + win;
    const needsChrome = n > win;
    if (needsChrome) {
      body.push(
        truncateVisible(
          start > 0 ? `   ▲ 更上 ${start} 条（共 ${n}）` : `   · 共 ${n} 条 · 向下浏览`,
          70
        )
      );
    }
    for (let i = start; i < end; i++) {
      const item = items[i]!;
      const mark = i === selected ? "▸" : " ";
      const active = item.active ? " ●" : "";
      body.push(truncateVisible(`${mark} ${item.label}${active}`, 70));
      if (item.description) {
        body.push(truncateVisible(`   ${item.description}`, 70));
      }
    }
    if (needsChrome) {
      body.push(
        truncateVisible(
          end < n
            ? `   ▼ 更下 ${n - end} 条 · ${selected + 1}/${n}`
            : `   · ${selected + 1}/${n} · 已到末尾`,
          70
        )
      );
    }
  }
  const n = items.length;
  const footer =
    footerHint ||
    (n > OPTION_PICKER_WINDOW
      ? `↑/↓ 浏览全部 ${n} 条 · Enter 确认 · Esc 取消`
      : `↑/↓ 选择 · Enter 确认 · Esc 取消 · 共 ${n} 条`);
  return frameLines(title, body, width, footer);
}

export function paintOptionPickerPanel(lines: string[]): string {
  return lines
    .map((line, idx) => {
      if (idx === 0 || idx === lines.length - 1 || idx === lines.length - 2) {
        return paint.primary(line);
      }
      const isSelectedRow = line.includes("▸");
      return isSelectedRow ? paint.secondary(line) : paint.dim(line);
    })
    .join("\n");
}
