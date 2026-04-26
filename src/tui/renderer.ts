// ============================================================
// TUIRenderer v3 - 逐行构建 + string-width 精确计算
//
// 策略：每一行都构建为完整字符串，再写入 screen
// 每一行 = sidebar列 + 间隔 + timeline列 + 间隔 + observ列
// 用 string-width 确保全角字符对齐
// ============================================================

import { default as stringWidth } from "string-width";
import { TUIRepl } from "./repl-tui.js";

const sw = (s: string): number => stringWidth(s);

// ANSI 颜色
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`;
}
const C = {
  p: "#36F5B5",   // primary
  s: "#75D7FF",   // secondary
  d: "#8B949E",   // dim text
  b: "#E6EDF3",   // bright
  g: "#4ADE80",   // green
  r: "#FB7185",   // red
  y: "#FACC15",   // yellow
  D: "#26323D",   // dark border
};
const F = (c: string, s: string) => `\x1b[38;2;${rgb(c)}m${s}\x1b[0m`;
const S = {
  p: (s: string) => F(C.p, s),
  s: (s: string) => F(C.s, s),
  d: (s: string) => F(C.d, s),
  b: (s: string) => F(C.b, s),
  g: (s: string) => F(C.g, s),
  r: (s: string) => F(C.r, s),
  y: (s: string) => F(C.y, s),
  D: (s: string) => F(C.D, s),
};

// 填充字符串到固定显示宽度（处理全角字符）
function pad(s: string, w: number): string {
  const n = sw(s);
  if (n >= w) return s;
  return s + " ".repeat(w - n);
}

// 截断字符串到最大显示宽度
function trunc(s: string, w: number): string {
  if (sw(s) <= w) return s;
  let i = 0;
  let col = 0;
  while (i < s.length && col < w - 1) {
    const cw = sw(s[i]);
    if (s[i] === "\x1b") {
      const j = s.indexOf("m", i);
      if (j === -1) break;
      i = j + 1;
      continue;
    }
    if (col + cw > w - 1) break;
    col += cw;
    i++;
  }
  return s.slice(0, i) + "…";
}

// 布局
interface Layout {
  W: number;
  H: number;
  sw: number;   // sidebar width
  tw: number;   // timeline width
  ow: number;   // observatory width
  headerH: number;
  inputH: number;
  bodyH: number;
}

function layout(W: number, H: number): Layout {
  const headerH = 2;
  const inputH = 2;
  let sw = 0, ow = 0;
  if (W >= 120) { sw = 22; ow = 30; }
  else if (W >= 90) { sw = 18; ow = 26; }
  else if (W >= 70) { sw = 0; ow = 24; }
  const tw = W - sw - ow;
  const bodyH = H - headerH - inputH - 1;
  return { W, H, sw, tw, ow, headerH, inputH, bodyH };
}

// ============================================================
// TUIRenderer
// ============================================================

export class TUIRenderer {
  private state = "idle";
  private model = "deepseek-chat";
  private path = "";
  private tools = 0;
  private tokens = 0;
  private context = 0;
  private passCount = 0;
  private failCount = 0;
  private errors = 0;
  private termW = 120;
  private termH = 30;

  constructor() {
    this.termW = process.stdout.columns || 120;
    this.termH = process.stdout.rows || 30;
    this.path = process.cwd().replace(/\\/g, "/").replace(/^C:/, "C:");
  }

  // 一次性渲染整屏（每个区域只渲染一次）
  render(): void {
    const L = layout(this.termW, this.termH);
    const lines: string[] = [];

    // 第0-1行：Header
    const [h0, h1] = this.headerLines(L);
    lines.push(h0, h1);

    // 第2行：分隔线
    lines.push(this.separatorLine(L));

    // 第3行到最后-2行：Body
    const bodyLines = this.bodyLines(L);
    lines.push(...bodyLines);

    // 最后2行：Input
    const [i0, i1] = this.inputLines(L);
    lines.push(i0, i1);

    // 整屏输出
    const out = "\x1b[2J\x1b[H\x1b[?25l" + lines.join("\n");
    process.stdout.write(out);
  }

  private headerLines(L: Layout): [string, string] {
    const { W } = L;
    // 第1行
    const l1 = pad(`> ${S.p("轻灵 Agent CLI")}   [*] ${S.d(this.state)}   ${S.s(this.model)}   ${S.g("online")}`, W);
    // 第2行
    const l2 = pad(`${S.d(this.path)}        ${S.d("tools")} ${S.d(String(this.tools))}   ${S.d("token")} ${S.d("~"+String(this.tokens))}   ${S.d("context")} ${S.d(String(this.context))}`, W);
    return [l1, l2];
  }

  private separatorLine(L: Layout): string {
    const { W, sw, tw, ow } = L;
    const sep = S.D("│");
    const h = S.D("─");

    if (sw > 0 && ow > 0) {
      return S.D("├") + h.repeat(sw) + S.D("┼") + h.repeat(tw) + S.D("┤");
    } else if (sw > 0) {
      return S.D("├") + h.repeat(sw) + S.D("┤");
    } else if (ow > 0) {
      return S.D("├") + h.repeat(tw) + S.D("┤");
    } else {
      return S.D("├") + h.repeat(tw) + S.D("┤");
    }
  }

  private bodyLines(L: Layout): string[] {
    const { H, sw, tw, ow, headerH, inputH, bodyH } = L;
    const sep = S.D("│");
    const blank = sw > 0 ? pad("", sw) : "";
    const oBlank = ow > 0 ? pad("", ow) : "";
    const totalBodyLines = H - headerH - inputH - 1;
    const lines: string[] = [];

    for (let i = 0; i < totalBodyLines; i++) {
      const sy = i + headerH + 1;
      if (sy >= H - inputH) break;
      const left = sw > 0 ? this.sidebarLine(i) : "";
      const mid = this.timelineLine(i);
      const right = ow > 0 ? this.observLine(i) : "";
      let row: string;
      if (sw > 0 && ow > 0) {
        row = pad(left, sw) + sep + pad(mid, tw) + sep + pad(right, ow);
      } else if (sw > 0) {
        row = pad(left, sw) + sep + pad(mid, tw);
      } else if (ow > 0) {
        row = pad(mid, tw) + sep + pad(right, ow);
      } else {
        row = pad(mid, tw);
      }
      lines.push(row);
    }
    return lines;
  }

  private sidebarLine(row: number): string {
    const { sw } = layout(this.termW, this.termH);
    const lines: string[] = [
      S.d("SESSION"),
      "  " + S.b("*") + " " + S.d("当前会话"),
      "",
      S.d("COMMANDS"),
      "  " + S.d("/plan   制定计划"),
      "  " + S.d("/reset  重置对话"),
      "  " + S.d("/tools  工具列表"),
      "  " + S.d("/debug  调试模式"),
      "",
      S.d("PROJECT"),
      "  " + S.s("qingling"),
    ];
    return row < lines.length ? trunc(lines[row], sw) : "";
  }

  private timelineLine(row: number): string {
    const { tw } = layout(this.termW, this.termH);
    const lines: string[] = [
      S.p("Welcome to Qingling"),
      "",
      S.d("输入自然语言任务，轻灵会自动规划、"),
      S.d("调用工具、验证结果并修复错误。"),
      "",
      S.d("快捷示例："),
      "  " + S.d("查询郑州今天天气"),
      "  " + S.d("总结当前目录结构"),
      "  " + S.d("修复上一次命令错误"),
      "  " + S.d("生成 README 文档"),
    ];
    return row < lines.length ? trunc(lines[row], tw) : "";
  }

  private observLine(row: number): string {
    const { ow } = layout(this.termW, this.termH);
    const pairs = [
      S.d("STATE"),
      "  " + this.state,
      S.d("MODEL"),
      "  " + this.model,
      S.d("TOOLS"),
      `  ${this.tools} ready`,
      S.d("VALIDATION"),
      `  pass ${this.passCount} / fail ${this.failCount}`,
      S.d("ERRORS"),
      "  " + (this.errors === 0 ? "none" : String(this.errors)),
      S.d("MEMORY"),
      "  no observations",
    ];
    return row < pairs.length ? trunc(pairs[row], ow) : "";
  }

  private inputLines(L: Layout): [string, string] {
    const { W } = L;
    const l1 = S.p(">") + " " + S.d("输入任务，或使用 /plan /run /tools /debug");
    const l2 = S.d("Enter 发送  |  Ctrl+C 退出  |  / 命令");
    return [pad(l1, W), pad(l2, W)];
  }

  // Public API
  setAgentState(state: string): void { this.state = state; this.render(); }
  setTools(n: number): void { this.tools = n; this.render(); }
  setTokens(n: number): void { this.tokens = n; this.render(); }
  setContext(n: number): void { this.context = n; this.render(); }
  setModel(m: string): void { this.model = m; this.render(); }
  setValidation(pass: number, fail: number): void { this.passCount = pass; this.failCount = fail; this.render(); }
  setErrors(n: number): void { this.errors = n; this.render(); }
  refresh(): void { this.render(); }
  start(_repl: TUIRepl): void { this.render(); }
  resize(w: number, h: number): void { this.termW = w; this.termH = h; this.render(); }
}
