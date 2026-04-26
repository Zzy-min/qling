// ============================================================
// TopStatusBar - 两行状态栏
// ============================================================

import { S, stateIcon, stripAnsi } from "../styles/theme.js";

function ansiLen(s: string): number {
  return stripAnsi(s).length;
}

export interface StatusBarOptions {
  mode: string;
  model: string;
  networkStatus: "online" | "offline";
  path: string;
  tools: number;
  sessionTokens: number;
  contextLength: number;
  sessionCount: number;
  terminalWidth: number;
}

export function renderTopStatusBar(opt: StatusBarOptions): string[] {
  const {
    mode, model, networkStatus,
    path, tools, sessionTokens,
    contextLength, sessionCount,
    terminalWidth: W,
  } = opt;

  const lines: string[] = [];

  // ── 第 1 行：品牌 + 状态 + 模型 + 网络 ──
  const netIcon = networkStatus === "online"
    ? `${S.success("◉")} ${S.success("online")}`
    : `${S.error("○")} ${S.error("offline")}`;

  const stateLabel = stateIcon(mode) + " " + S.secondary(mode);
  const modelLabel = S.brandSec(model);

  const left = `${S.brand("🌬")} ${S.highlight("轻灵 Agent CLI")}`;
  const mid = `  ${stateLabel}  ${modelLabel}`;
  const right = netIcon;

  // 计算间距
  const leftLen = ansiLen(left);
  const midLen = ansiLen(mid);
  const rightLen = ansiLen(right);
  const totalLen = leftLen + midLen + rightLen;
  const sep = "  ";
  const pad = Math.max(2, W - totalLen - sep.length * 2);

  lines.push(S.bgPanel(left + sep + mid + sep + " ".repeat(pad) + right));

  // ── 第 2 行：路径 + 指标 ──
  const tokensDisplay = `token ~${sessionTokens}`;
  const contextDisplay = `context ${contextLength}`;
  const toolsDisplay = `tools ${tools}`;
  const sessionDisplay = `session ${sessionCount}`;

  const pathColor = S.secondary(path);
  const sep2 = S.dim("  ·  ");

  const left2 = S.dim("📁 ") + pathColor;
  const right2Parts = [
    [S.dim("🔧"), toolsDisplay],
    [S.dim("◆"), tokensDisplay],
    [S.dim("▣"), contextDisplay],
    [S.dim("📁"), sessionDisplay],
  ].map(([icon, text]) => `${icon} ${S.secondary(text)}`);

  const right2 = right2Parts.join(sep2);

  const left2Len = ansiLen(left2);
  const right2Len = ansiLen(right2);
  const pad2 = Math.max(1, W - left2Len - right2Len - 1);

  lines.push(left2 + " ".repeat(pad2) + right2);

  return lines;
}
