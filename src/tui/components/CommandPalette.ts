// ============================================================
// CommandPalette - 命令面板覆盖层
// ============================================================

import { S, truncate } from "../styles/theme.js";

export interface CommandItem {
  command: string;
  description: string;
  shortcut?: string;
}

export interface CommandPaletteOptions {
  filter: string;
  items: CommandItem[];
  selectedIndex: number;
  availableWidth: number;
}

export function renderCommandPalette(opt: CommandPaletteOptions): string[] {
  const { filter, items, selectedIndex, availableWidth: W } = opt;
  const lines: string[] = [];
  const bodyW = W - 2;

  // 过滤
  const filtered = filter === ""
    ? items
    : items.filter(
        (item) =>
          item.command.toLowerCase().includes(filter.toLowerCase()) ||
          item.description.toLowerCase().includes(filter.toLowerCase())
      );

  // 标题行
  const title = filter === "" ? "命令面板" : `命令面板 › ${filter}`;
  lines.push(`${S.brandSec("╭─")} ${S.highlight(title)} ${S.dim("─".repeat(Math.max(0, bodyW - stripLen(title) - 4)))}╮`);

  // 搜索行
  const searchLine = ` ${S.secondary("›")} ${S.primary(filter || S.muted("输入过滤..."))}`;
  lines.push(searchLine + " ".repeat(Math.max(0, bodyW - stripLen(searchLine) - 1)) + S.brandSec("│"));

  // 分隔线
  lines.push(`${S.brandSec("├")}${S.dim("─".repeat(bodyW))}${S.brandSec("┤")}`);

  // 命令列表
  if (filtered.length === 0) {
    lines.push(`${S.brandSec("│")}  ${S.muted("无匹配命令")}${" ".repeat(Math.max(0, bodyW - 12))}${S.brandSec("│")}`);
  } else {
    for (let i = 0; i < Math.min(filtered.length, 10); i++) {
      const item = filtered[i];
      const isSelected = i === selectedIndex;
      const cmdStr = `${S.brand(item.command)}  ${S.secondary(item.description)}`;
      const line = ` ${S.brandSec("│")}  ${cmdStr}`;
      const padded = line + " ".repeat(Math.max(0, bodyW - stripLen(line) - 1)) + S.brandSec("│");
      lines.push(isSelected ? S.bgHover(padded) : padded);
    }
  }

  // 底部
  lines.push(`${S.brandSec("╰")}${S.dim("─".repeat(bodyW))}${S.brandSec("╯")}`);

  return lines;
}

function stripLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}
