// ============================================================
// streaming-tui.ts - Claude Code 风格流式 Agent CLI
//
// 架构原则：
// 1. Header 只打印一次（启动时）
// 2. 所有输出追加到终端历史，从不重绘
// 3. 底部输入栏：› prompt，支持 Ctrl+N 插入多行、Ctrl+R 搜索历史
// 4. Agent 执行期间输入栏保持可用
// 5. 执行完毕后调用 showPrompt() 恢复 › prompt
//
// 事件输出（全部 append，不清屏）：
// appendToolStart / appendToolSuccess / appendToolError
// appendThinking / appendCogitated
// appendValidation / appendRepair
// appendFinal / appendError / appendState / appendDone
// ============================================================

import * as readline from "readline";
import { default as stringWidth } from "string-width";
import {
  resolveSlashUiPorts,
  type SlashUiPorts,
} from "../slash-ports.js";
import { InputBuffer } from "./input-buffer.js";
import { formatProgressPulse } from "./progress.js";
import {
  formatRoleHeader,
  formatResultHighlight,
  formatToolOutputCard,
  formatToolTimelineRow,
  formatTopBar,
  padVisible,
  truncateVisible,
} from "./shell.js";
import {
  formatOptionPickerPanel,
  formatSessionPickerPanel,
  formatTurnBrowsePanel,
  paintOptionPickerPanel,
  paintSessionPickerPanel,
  paintTurnBrowsePanel,
  type OptionPickerItem,
  type OptionPickerSpec,
  type SessionPickerItem,
  type TurnBrowseItem,
} from "./overlay-panel.js";
import { sortSessionFleet } from "./session-fleet.js";
import { formatMarkdownForTerminal } from "./markdown.js";
import { getPackageVersion } from "../package-version.js";
import type { RecoveryState } from "../execution/types.js";
import {
  modeBorderHex,
  modeCapabilityFooter,
  modeInputTopLabel,
  modePlaceholder,
  modePromptPrefix,
  paintModeSegment,
  resolveGrokUiMode,
} from "./mode-chrome.js";
import { boldAnsi, dimAnsi, fg, getBorderChars, paint } from "./theme.js";
import { enterTuiQuietMode, leaveTuiQuietMode } from "../runtime/console-guard.js";
import {
  isInternalUserNoise,
  isToolOnlyAssistantText,
} from "../session/session-title.js";
import {
  captureJumpRestore,
  lookupAction,
  type JumpRestore,
} from "./actions.js";
import type { TuiFocus } from "./focus-model.js";
import { tabStructuralFocus } from "./focus-model.js";

// ── ANSI 颜色工具（短别名兼容既有调用） ─────────────────

const DIM = dimAnsi;
const BOLD = boldAnsi;
const S = {
  p: paint.primary,
  s: paint.secondary,
  d: paint.dim,
  b: paint.bright,
  g: paint.success,
  r: paint.error,
  y: paint.warn,
  m: paint.magenta,
};

// ── 显示宽度工具 ────────────────────────────────────────

const sw = (s: string): number => stringWidth(s);

function trunc(s: string, maxW: number): string {
  if (sw(s) <= maxW) return s;
  let col = 0;
  let i = 0;
  while (i < s.length && col < maxW - 1) {
    const cw = sw(s[i]);
    if (col + cw > maxW - 1) break;
    col += cw;
    i++;
  }
  return s.slice(0, i) + "…";
}

// ── Duration 格式化 ─────────────────────────────────────

function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

// ── StreamUI 主类 ──────────────────────────────────────

export type AgentEvent =
  | { type: "tool_start"; tool: string; command: string }
  | { type: "tool_success"; tool: string; command: string; output: string; durationMs: number }
  | { type: "tool_error"; tool: string; command: string; error: string; durationMs: number }
  | { type: "thinking"; text: string }
  | { type: "cogitated"; durationMs: number }
  | { type: "validation"; status: "pass" | "fail" | "warn"; text: string }
  | { type: "repair"; reason: string; action: string; retryCount: number }
  | { type: "final"; text: string }
  | { type: "error"; text: string }
  | { type: "state"; from: string; to: string }
  | { type: "done"; durationMs: number };

type DraftDisplaySource = "typed" | "pasted";

export class StreamUI {
  private model: string;
  private tools: number;
  private chromeStatus: {
    tokens?: number;
    branch?: string | null;
    workspace?: string;
    ready?: boolean;
    permissionMode?: string;
    sessionMode?: string;
    memoryStatus?: string;
  } = {};
  private input = new InputBuffer();
  private running: boolean = false;
  private inputCallback: ((cmd: string) => Promise<void>) | null = null;
  private currentToolRunning: boolean = false;
  private dataHandler: ((chunk: string) => void) | null = null;
  private resizeHandler: (() => void) | null = null;
  private statusLine: string | null = null;
  private statusLineEnabled = true;
  private progressTimer: NodeJS.Timeout | null = null;
  private progressStartedAt = 0;
  private progressLabel = "agent";
  private lastEmptyCtrlCAt = 0;
  private lastClearedDraft: string | null = null;
  private lastClearedDraftDisplaySource: DraftDisplaySource | null = null;
  private draftDisplaySource: DraftDisplaySource | null = null;
  private expandLongToolOutput = false;
  private lastInputContentLineCount = 1;
  private lastInputCursorLineIndex = 0;
  private lastInputHintLineCount = 0;
  private slashCompletionSelectedIndex = 0;
  private inputCursorAnchor: "current" | "bottom" = "current";
  private inputStartRow = 0;
  /**
   * true = 输入框是活动编辑区（光标在框内）。
   * false = 光标不在输入框内。
   */
  private promptLive = false;
  /**
   * true = 任务/回放流式输出中。此时禁止 redraw 输入框，
   * 否则 resize/按键/validation 会把 spinner 画进框内。
   */
  private streamActive = false;
  /**
   * true = 顶栏与输入框仍紧挨（其间无对话流）。
   * 此时 Shift+Tab 可用相对上移擦除「顶栏+输入」整块再重画，避免 Windows 清屏失败叠双顶栏。
   * 一旦 ensureStreamMode / 对话输出，置 false，模式切换只原位改输入框。
   */
  private chromeContiguous = true;
  /** 顶栏固定 2 行（产品行 + 分隔线） */
  private readonly headerLineCount = 2;
  private recoveryState: RecoveryState | null = null;
  private readonly now: () => number;
  private readonly doubleCtrlCExitWindowMs = 2_000;
  private slashUi: SlashUiPorts | null = null;
  private readonly slashUiPromise: Promise<SlashUiPorts>;

  /** G1/G3: 浮层 — 会话 / 轮次 / 通用选项切换器 */
  private overlay:
    | null
    | {
        kind: "sessions";
        items: SessionPickerItem[];
        selected: number;
        /** 面板本身行数 */
        lineCount: number;
        /** 面板 + 其下输入框(+hints) 总行数，用于原地擦除 */
        blockLines: number;
      }
    | {
        kind: "turns";
        items: TurnBrowseItem[];
        selected: number;
        lineCount: number;
        blockLines: number;
      }
    | {
        kind: "options";
        title: string;
        items: OptionPickerItem[];
        /** filterable 时的完整列表 */
        allItems?: OptionPickerItem[];
        filterable?: boolean;
        selected: number;
        footerHint?: string;
        onPick: (item: OptionPickerItem) => void | Promise<void>;
        lineCount: number;
        blockLines: number;
      } = null;
  /** slash 多行输出已擦掉输入框、正在追加中 */
  private slashOutputActive = false;
  private turnLog: Array<{ preview: string; fullText: string }> = [];
  private lastToolOutputBlob: string | null = null;
  private onRequestSessionList: (() => void | Promise<void>) | null = null;
  private onSessionPick: ((sessionId: string) => void | Promise<void>) | null = null;
  /** Shift+Tab：在原输入框内切模式，不提交、不另起输入框 */
  private onModeCycle: (() => void | Promise<void>) | null = null;
  /** 对标 Grok ActivePane：prompt | scrollback */
  private focus: TuiFocus = "prompt";
  /** 对标 JumpRestore：打开浮层前快照，Esc 恢复 */
  private jumpRestore: JumpRestore | null = null;
  private turnSelected = 0;

  constructor(
    model: string = "deepseek-chat",
    tools: number = 0,
    options: { now?: () => number; slashUi?: SlashUiPorts } = {}
  ) {
    this.model = model;
    this.tools = tools;
    this.now = options.now ?? (() => Date.now());
    if (options.slashUi) {
      this.slashUi = options.slashUi;
      this.slashUiPromise = Promise.resolve(options.slashUi);
    } else {
      this.slashUiPromise = resolveSlashUiPorts().then((ports) => {
        this.slashUi = ports;
        return ports;
      });
    }
  }

  /** REPL 注入：打开会话列表时拉数据 */
  setSessionPickerHandlers(handlers: {
    onRequestSessionList: () => void | Promise<void>;
    onSessionPick: (sessionId: string) => void | Promise<void>;
  }): void {
    this.onRequestSessionList = handlers.onRequestSessionList;
    this.onSessionPick = handlers.onSessionPick;
  }

  /** Shift+Tab 模式循环（REPL 注入，原位更新 chrome + 输入框） */
  setModeCycleHandler(handler: () => void | Promise<void>): void {
    this.onModeCycle = handler;
  }

  /**
   * 更新模式 chrome（Shift+Tab / /mode）。
   *
   * - 顶栏仍紧挨输入框时：相对上移擦除「顶栏+输入」整块，再画一次（不依赖 Windows 清屏）
   * - 已有对话流隔开时：只原位重画输入框（模式角标在框上，避免去动远处顶栏叠双份）
   */
  applySessionChrome(patch: {
    sessionMode?: string;
    permissionMode?: string;
  }): void {
    if (patch.sessionMode !== undefined) {
      this.chromeStatus.sessionMode = patch.sessionMode;
    }
    if (patch.permissionMode !== undefined) {
      this.chromeStatus.permissionMode = patch.permissionMode;
    }
    if (!this.running) return;
    if (this.streamActive) return;
    if (this.overlay) return;

    if (this.chromeContiguous && this.promptLive) {
      this.eraseContiguousChromeBlock();
      this.printHeader();
      this.printInputBar();
      this.syncCursor();
      return;
    }
    if (this.promptLive) {
      this.redrawInput();
    }
  }

  /**
   * 光标在输入区时，上移擦除「顶栏 2 行 + 输入框(+hints)」连续块。
   * 不使用 \x1b[2J（Windows 常失败导致内容只追加不清除）。
   */
  private eraseContiguousChromeBlock(): void {
    // 先到输入块底行
    if (this.inputCursorAnchor === "current") {
      const down = Math.max(
        0,
        this.lastInputContentLineCount + this.lastInputHintLineCount - this.lastInputCursorLineIndex
      );
      if (down > 0) process.stdout.write("\x1b[" + down + "B");
    }
    const inputBlock = Math.max(
      1,
      this.lastInputContentLineCount + this.lastInputHintLineCount
    );
    const total = this.headerLineCount + inputBlock;
    // 底行上移 total-1 到顶栏第一行，再清到屏尾
    const rowsUp = Math.max(1, total - 1);
    process.stdout.write("\x1b[" + rowsUp + "A\r\x1b[J");
    this.promptLive = false;
    this.inputCursorAnchor = "current";
    this.lastInputCursorLineIndex = 0;
    this.lastInputContentLineCount = 1;
    this.lastInputHintLineCount = 0;
  }

  /** 由 REPL 在拉到 sessions 后调用（G4 舰队：状态优先排序） */
  showSessionPicker(items: SessionPickerItem[]): void {
    // 全量列表；可视窗口在 panel 内滑动，不再硬截断只留 24 条
    // slash Enter 后 streamActive 可能为 true；切换器需可交互
    this.streamActive = false;
    // 若已有其它浮层（options/turns），先擦除再开，避免叠层
    if (this.overlay) {
      this.closeOverlay(undefined, true);
    }
    // G4：对标 Grok group_priority — active > idle > stale，同级 updatedAt 降序
    // 排序在此完成，format 层保持 selected 下标稳定
    const mapped = sortSessionFleet(items).map((row) => ({
      sessionId: row.sessionId,
      name: row.name,
      updatedAt: row.updatedAt,
      turnCount: row.turnCount,
      messageCount: row.messageCount,
      sessionTokens: row.sessionTokens,
      workspaceDir: row.workspaceDir,
      active: row.active,
    }));
    this.armJumpRestore();
    this.focus = "scrollback";
    this.overlay = {
      kind: "sessions",
      items: mapped,
      selected: Math.max(
        0,
        mapped.findIndex((i) => i.active)
      ),
      lineCount: 0,
      blockLines: 0,
    };
    if (this.overlay.selected < 0) this.overlay.selected = 0;
    this.paintOverlay(false);
  }

  openSessionPicker(): void {
    // 对标 jump_slot_taken：其它浮层打开时先关再开 sessions（避免叠层）
    if (this.overlay) {
      this.closeOverlay(undefined, true);
    }
    void this.onRequestSessionList?.();
  }

  /**
   * 通用选项切换器（model / theme / sandbox / mode …）。
   * 规则与会话切换器一致：
   * - 打开前关闭已有浮层并擦除 block
   * - 导航原地 replace paint（不追加）
   * - 确认先 close 再 onPick（副作用不画在浮层内）
   *
   * 注意：slash Enter 会把 streamActive=true；此处必须允许打开，
   * 并清掉 stream 标志，否则切换器静默失败 + showPrompt 叠空框。
   */
  showOptionPicker(spec: OptionPickerSpec): void {
    if (!this.running) return;
    const items = [...(spec.items ?? [])];
    if (items.length === 0) return;

    // 从 slash 提交态恢复为可交互 chrome（会话切换器同理不挡 streamActive）
    this.streamActive = false;

    if (this.overlay) {
      this.closeOverlay(undefined, true);
    }

    let selected = 0;
    if (spec.selectedId) {
      const byId = items.findIndex((i) => i.id === spec.selectedId);
      if (byId >= 0) selected = byId;
    } else {
      const byActive = items.findIndex((i) => i.active);
      if (byActive >= 0) selected = byActive;
    }

    this.armJumpRestore();
    // filterable 斜杠/技能切换器：焦点仍在 prompt，可继续键入过滤（含空格）
    this.focus = spec.filterable ? "prompt" : "scrollback";
    const filterable = Boolean(spec.filterable);
    this.overlay = {
      kind: "options",
      title: spec.title || "选择",
      items,
      allItems: filterable ? [...items] : undefined,
      filterable,
      selected,
      footerHint: spec.footerHint,
      onPick: spec.onPick,
      lineCount: 0,
      blockLines: 0,
    };
    // 打开时若输入区已有检索词（如 /skill search foo），立即按词过滤
    if (filterable && this.input.value.trim()) {
      this.refilterSlashPicker();
    } else {
      this.paintOverlay(false);
    }
  }

  openOptionPicker(spec: OptionPickerSpec): void {
    this.showOptionPicker(spec);
  }

  isOverlayOpen(): boolean {
    return this.overlay !== null;
  }

  getFocus(): TuiFocus {
    return this.focus;
  }

  /** 测试/REPL：取消浮层并恢复 JumpRestore → 始终回到可编辑 prompt（AC3） */
  dismissOverlay(hint?: string): void {
    this.closeOverlay(hint, true);
  }

  /** 测试/REPL：确认当前浮层选择（Enter） */
  confirmOverlay(): void {
    this.handleOverlayEnter();
  }

  /** 测试/REPL：浮层选择移动 */
  moveOverlay(delta: number): void {
    this.moveOverlaySelection(delta);
  }

  /** 测试/REPL：打开轮次浏览（空输入语义的公开入口） */
  openTurnBrowser(delta = 0): void {
    if (this.input.value.trim()) return;
    this.openTurnBrowse(delta);
  }

  getOverlayKind(): "sessions" | "turns" | "options" | null {
    return this.overlay?.kind ?? null;
  }

  getOverlaySelectedIndex(): number {
    return this.overlay?.selected ?? -1;
  }

  /**
   * 单键序列调度（测试与可编程入口）。
   * 避免多测并行抢 process.stdin。
   */
  dispatchKey(seq: string): void {
    if (!this.running) return;
    if (seq === "\x1c") {
      this.handleSessionPickerToggle();
      return;
    }
    if (seq === "\x1b") {
      if (this.overlay) this.dismissOverlay();
      return;
    }
    if (seq === "\r" || seq === "\n") {
      if (this.overlay) this.handleOverlayEnter();
      else this.handleEnter();
      return;
    }
    if (seq === " ") {
      this.handleSpaceKey();
      return;
    }
    if (seq === "\t") {
      this.handleTab();
      return;
    }
    // Shift+Tab（常见 CSI u / 传统 \x1b[Z）
    if (seq === "\x1b[Z" || seq === "\x1b[1;2Z") {
      this.handleShiftTab();
      return;
    }
    if (seq === "\x03") {
      if (this.overlay) this.dismissOverlay();
      else this.handleCtrlC();
      return;
    }
    if (seq === "\x1b[A") {
      if (this.overlay) this.moveOverlaySelection(-1);
      else if (this.focus === "scrollback") this.navigateTurns(-1);
      else this.handleHistoryUp();
      return;
    }
    if (seq === "\x1b[B") {
      if (this.overlay) this.moveOverlaySelection(1);
      else if (this.focus === "scrollback") this.navigateTurns(1);
      else this.handleHistoryDown();
      return;
    }
    if (seq === "\x1b[5~" || seq === "\x1b[1;2A") {
      this.navigateTurns(-1);
      return;
    }
    if (seq === "\x1b[6~" || seq === "\x1b[1;2B") {
      this.navigateTurns(1);
      return;
    }
    if (seq === "\x0f") {
      if (!this.overlay) this.handleCtrlO();
      return;
    }
    // filterable 切换器：允许光标在输入区左右移动（↑↓ 仍用于列表）
    if (seq === "\x1b[D") {
      if (this.isFilterableOverlay()) this.handleLeft();
      return;
    }
    if (seq === "\x1b[C") {
      if (this.isFilterableOverlay()) this.handleRight();
      return;
    }
    if (seq === "\x1b[H" || seq === "\x1b[1~") {
      if (this.isFilterableOverlay()) this.handleHome();
      return;
    }
    if (seq === "\x1b[F" || seq === "\x1b[4~") {
      if (this.isFilterableOverlay()) this.handleEnd();
      return;
    }
    if (seq.length === 1 && seq >= " ") {
      if (
        !this.overlay ||
        (this.overlay.kind === "options" && this.overlay.filterable)
      ) {
        this.handleChar(seq);
      }
    }
  }

  /** 斜杠/技能等可键入过滤的切换器：输入区应保留光标编辑 */
  private isFilterableOverlay(): boolean {
    return this.overlay?.kind === "options" && Boolean(this.overlay.filterable);
  }

  private armJumpRestore(): void {
    if (!this.jumpRestore) {
      this.jumpRestore = captureJumpRestore(this.focus, this.turnSelected);
    }
  }

  private lookupCtx() {
    return {
      focus: this.focus,
      overlayOpen: this.overlay !== null,
      inputEmpty: !this.input.value.trim(),
    };
  }

  /** 展开并重绘最近一次工具输出（/expand last） */
  expandLastToolOutput(): boolean {
    if (!this.lastToolOutputBlob?.trim()) return false;
    this.expandLongToolOutput = true;
    this.moveAfterInputFrame();
    process.stdout.write("\n" + S.s("📄 重放最近工具输出（展开）") + "\n");
    this.printToolOutput(this.lastToolOutputBlob, "success");
    this.writeInputValue(true);
    this.syncCursor();
    return true;
  }

  start(): void {
    this.running = true;
    // 先进入安静模式，再画框，避免后续 ProjectionWorker/Memory 日志打穿输入区
    enterTuiQuietMode();
    void this.slashUiPromise;
    this.printHeader();
    this.printInputBar();
    this.setupInput();
  }

  stop(): void {
    this.running = false;
    this.stopProgress();
    leaveTuiQuietMode();
    if (this.dataHandler) {
      process.stdin.off("data", this.dataHandler);
      this.dataHandler = null;
    }
    if (this.resizeHandler) {
      process.stdout.off("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    process.stdout.write("\n");
  }

  onInput(cb: (cmd: string) => Promise<void>): void {
    this.inputCallback = cb;
  }

  setStatusLine(line: string | null): void {
    this.statusLine = line;
  }

  setStatusLineEnabled(enabled: boolean): void {
    this.statusLineEnabled = enabled;
  }

  setChromeStatus(status: {
    tokens?: number;
    branch?: string | null;
    workspace?: string;
    ready?: boolean;
    permissionMode?: string;
    sessionMode?: string;
    memoryStatus?: string;
  }): void {
    this.chromeStatus = { ...this.chromeStatus, ...status };
  }

  setModel(model: string): void {
    const next = String(model ?? "").trim();
    if (next) this.model = next;
  }

  setRecoveryState(state: RecoveryState | null): void {
    this.recoveryState = state ? { ...state } : null;
    if (state?.status === "paused") this.appendRecoveryCard(state);
  }

  setInputDraft(draft: string): void {
    this.input.clear();
    for (const ch of draft) ch === "\n" ? this.input.insertNewline() : this.input.insertChar(ch);
    this.draftDisplaySource = draft.includes("\n") ? "typed" : null;
    this.redrawInput();
  }

  /** 测试 / slash 副作用：读取当前输入草稿 */
  getInputDraft(): string {
    return this.input.value;
  }

  private appendRecoveryCard(state: RecoveryState): void {
    this.ensureStreamMode();
    const failure = state.lastFailure;
    process.stdout.write("\n" + [
      S.y("执行已暂停"),
      `${DIM("原因")} ${failure?.category ?? "unknown"}: ${failure?.message ?? "-"}`,
      `${DIM("证据")} ${failure?.fingerprint ?? "-"}  ${DIM("剩余预算")} ${state.remainingStrategyAttempts}`,
      `${S.p("R")} 重试  ${S.p("S")} 下一策略  ${S.p("E")} 编辑任务  ${S.p("C")} 取消并保存摘要`,
    ].join("\n") + "\n");
    this.streamActive = false;
    this.writeInputValue(true);
    this.syncCursor();
    this.promptLive = true;
  }

  isExpandLongToolOutput(): boolean {
    return this.expandLongToolOutput;
  }

  setExpandLongToolOutput(expanded: boolean): void {
    this.expandLongToolOutput = Boolean(expanded);
  }

  toggleExpandLongToolOutput(): boolean {
    this.expandLongToolOutput = !this.expandLongToolOutput;
    return this.expandLongToolOutput;
  }

  setHistory(entries: string[]): void {
    this.input.setHistory(entries);
  }

  startProgress(label: string = "agent", intervalMs: number = 80): void {
    this.stopProgress();
    // 绝不在活动输入框内容行上 \r，否则会画出「框里转圈」的错乱画面
    this.ensureStreamMode();
    this.progressLabel = label.trim() || "agent";
    this.progressStartedAt = Date.now();
    // 独占一行：后续 \r 只刷新这一行
    process.stdout.write("\n");
    const paint = () => {
      const elapsedMs = Date.now() - this.progressStartedAt;
      process.stdout.write(
        "\r\x1b[K" + formatProgressPulse(this.progressLabel, elapsedMs)
      );
    };
    paint();
    const safeIntervalMs = intervalMs;
    this.progressTimer = setInterval(paint, safeIntervalMs);
    this.progressTimer.unref?.();
  }

  stopProgress(): void {
    if (!this.progressTimer) return;
    clearInterval(this.progressTimer);
    this.progressTimer = null;
    process.stdout.write("\r\x1b[K");
  }

  /** 清掉 spinner 当前行，但不停止计时（工具输出落盘前调用） */
  private clearProgressLine(): void {
    if (!this.progressTimer) return;
    process.stdout.write("\r\x1b[K");
  }

  // ── Header（只调用一次） ───────────────────────────

  private printHeader(): void {
    const width = process.stdout.columns || 120;
    const sessionMode = this.chromeStatus.sessionMode ?? "agent";
    const permissionMode = this.chromeStatus.permissionMode ?? "ask";
    const uiMode = resolveGrokUiMode(sessionMode, permissionMode);
    const lines = formatTopBar({
      productName: "轻灵",
      englishName: "Qling",
      version: getPackageVersion(),
      model: this.model,
      workspace: this.chromeStatus.workspace ?? process.cwd(),
      tokens: this.chromeStatus.tokens ?? 0,
      branch: this.chromeStatus.branch ?? "-",
      ready: this.chromeStatus.ready ?? true,
      sessionMode,
      permissionMode,
      width,
    });
    // Mode 段独立着色（normal=绿 plan=青 auto=黄），其余主色
    const plain = lines[0] ?? "";
    const modeToken = `Mode:${uiMode}`;
    const at = plain.indexOf(modeToken);
    let headLine: string;
    if (at >= 0) {
      const before = plain.slice(0, at);
      const after = plain.slice(at + modeToken.length);
      headLine = S.p(BOLD(before)) + paintModeSegment(uiMode) + S.p(BOLD(after));
    } else {
      headLine = S.p(BOLD(plain));
    }
    const sepW = Math.max(20, width);
    const accentLen = Math.min(14, sepW);
    const accentHex = modeBorderHex(uiMode);
    const sep =
      fg(accentHex, "━".repeat(accentLen)) + S.d("─".repeat(Math.max(0, sepW - accentLen)));
    process.stdout.write(headLine + "\n" + sep + "\n");
  }

  // ── 底部输入栏 ────────────────────────────────────

  /**
   * 输入框上方不再堆叠 statusline / 快捷键黑灰提示（去噪）。
   * 详情仍可通过 /statusline、/shortcuts 与顶栏查看。
   */
  private printPromptHint(): void {
    // intentionally empty — keep input chrome minimal
  }

  private printInputBar(): void {
    this.printPromptHint();
    this.writeInputValue(true);
    this.syncCursor();
    this.promptLive = true;
    this.streamActive = false;
  }

  private backToPrompt(): void {
    this.moveToInputContentStart();
    process.stdout.write("\r");
    process.stdout.write("\x1b[J");
    this.promptLive = false;
  }

  /**
   * Enter 提交后：光标已在旧输入框下方，inputCursorAnchor=current、cursorLine=0，
   * backToPrompt 的 rowsUp 会变成 0，无法擦掉「/theme + 补全提示」残留。
   * 用提交前仍保留的 lastInput* 行数整块上移擦除。
   */
  private eraseSubmittedInputBlock(): void {
    const rows = Math.max(
      0,
      this.lastInputContentLineCount + this.lastInputHintLineCount
    );
    if (rows > 0) {
      process.stdout.write("\x1b[" + rows + "A\r\x1b[J");
    } else {
      process.stdout.write("\r\x1b[J");
    }
    this.lastInputCursorLineIndex = 0;
    this.inputCursorAnchor = "current";
    this.lastInputContentLineCount = 1;
    this.lastInputHintLineCount = 0;
    this.promptLive = false;
  }

  /**
   * 打开浮层前清掉当前输入 chrome：
   * - 活动输入框 → backToPrompt
   * - 刚提交残留块 → eraseSubmittedInputBlock
   */
  private clearInputChromeForOverlay(): void {
    if (this.promptLive) {
      this.backToPrompt();
      return;
    }
    if (this.lastInputContentLineCount + this.lastInputHintLineCount > 0) {
      this.eraseSubmittedInputBlock();
    }
  }

  private redrawInput(): void {
    // 仅任务流式期禁止；测试/未 start 时仍允许首绘输入框
    if (this.streamActive) return;
    if (this.promptLive) {
      this.moveToInputContentStart();
      process.stdout.write("\r\x1b[J");
    }
    this.writeInputValue(!this.input.value);
    this.syncCursor();
    this.promptLive = true;
  }

  /**
   * 空闲输入态：反馈写在旧框下方并重画输入框。
   * 任务流式态：只追加一行，绝不重画输入框。
   */
  private appendFeedbackAndRedraw(message: string, usePlaceholder = false): void {
    if (this.streamActive || !this.promptLive) {
      this.clearProgressLine();
      // 必须换行结束，避免进度条 \r 与下一条输出粘在同一行
      process.stdout.write("\n" + message + "\n");
      return;
    }
    this.moveAfterInputFrame();
    process.stdout.write("\n" + message + "\n");
    this.writeInputValue(usePlaceholder);
    this.syncCursor();
    this.promptLive = true;
  }

  /** 离开活动输入框，进入只追加的流式输出区（提交任务 / 工具输出前调用） */
  private ensureStreamMode(): void {
    if (this.promptLive) {
      this.moveAfterInputFrame();
      process.stdout.write("\n");
      this.promptLive = false;
    }
    this.streamActive = true;
    // 顶栏与输入之间将插入对话流，不再 contiguous
    this.chromeContiguous = false;
  }

  private wrapInputVisualLines(value: string, width: number, cursor: number): {
    lines: string[];
    cursorRow: number;
    cursorCol: number;
  } {
    if (width <= 0) {
      return { lines: [value], cursorRow: 0, cursorCol: 0 };
    }
    const lines: string[] = [""];
    let currentWidth = 0;
    let cursorRow = 0;
    let cursorCol = 0;
    let charIndex = 0;

    const chars = Array.from(value);
    for (const ch of chars) {
      if (charIndex === cursor) {
        cursorRow = lines.length - 1;
        cursorCol = currentWidth;
      }

      if (ch === "\n") {
        lines.push("");
        currentWidth = 0;
        charIndex += 1;
        continue;
      }

      const w = sw(ch);
      if (currentWidth + w > width) {
        lines.push("");
        currentWidth = 0;
      }

      lines[lines.length - 1] += ch;
      currentWidth += w;
      charIndex += ch.length;
    }

    if (charIndex === cursor) {
      cursorRow = lines.length - 1;
      cursorCol = currentWidth;
    }

    return { lines, cursorRow, cursorCol };
  }

  private formatByteSize(value: string): string {
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 10) return `${kb.toFixed(1)} KB`;
    return `${Math.round(kb)} KB`;
  }

  private countInputLines(value: string): number {
    if (!value) return 0;
    return value.split("\n").length;
  }

  private shouldUseCompactDraft(value: string, wrappedLineCount: number, isPlaceholder: boolean): boolean {
    return !isPlaceholder && Boolean(value) && (value.includes("\n") || wrappedLineCount > 1);
  }

  private formatDraftChip(value: string): string {
    const source = this.draftDisplaySource === "pasted" ? "pasted" : "typed";
    const size = this.formatByteSize(value);
    if (source === "pasted") {
      const lines = this.countInputLines(value);
      if (lines > 1) {
        return `[Pasted: ${lines} lines]`;
      }
      return `[Pasted: ${size}]`;
    }
    return `[Draft: ${this.countInputLines(value)} lines, ${size}]`;
  }

  private resetDraftDisplaySourceIfEmpty(): void {
    if (!this.input.value) {
      this.draftDisplaySource = null;
    }
  }

  private markPastedDraft(): void {
    if (this.input.value) {
      this.draftDisplaySource = "pasted";
    }
  }

  private formatInputFrameBorder(left: string, right: string, label: string, totalWidth: number): string {
    const h = getBorderChars().h;
    if (!label) {
      return left + h.repeat(totalWidth - 2) + right;
    }
    const text = " " + label + " ";
    const textLen = sw(text);
    const borderLen = totalWidth - 2;
    if (borderLen <= textLen) {
      return left + text.slice(0, borderLen) + right;
    }
    const leftDash = Math.floor((borderLen - textLen) / 2);
    const rightDash = borderLen - textLen - leftDash;
    return left + h.repeat(leftDash) + text + h.repeat(rightDash) + right;
  }

  private syncCursor(): void {
    const contentWidth = this.inputFrameContentWidth();
    const wrapWidth = contentWidth - 2;
    const wrapped = this.wrapInputVisualLines(this.input.value, wrapWidth, this.input.cursorPos);
    const compactDraft = this.shouldUseCompactDraft(this.input.value, wrapped.lines.length, false);
    const cursor = compactDraft
      ? { lineIndex: 2, columnText: " ".repeat(Math.min(contentWidth - 1, 2 + sw(this.formatDraftChip(this.input.value)))) }
      : this.inputCursorPosition(wrapped);

    if (this.inputCursorAnchor === "bottom") {
      const rowsUp = Math.max(0, this.lastInputContentLineCount + this.lastInputHintLineCount - cursor.lineIndex);
      if (rowsUp > 0) {
        process.stdout.write("\x1b[" + rowsUp + "A");
      }
    } else {
      const rowDelta = cursor.lineIndex - this.lastInputCursorLineIndex;
      if (rowDelta > 0) {
        process.stdout.write("\x1b[" + rowDelta + "B");
      } else if (rowDelta < 0) {
        process.stdout.write("\x1b[" + Math.abs(rowDelta) + "A");
      }
    }
    const col = 5 + cursor.columnText.length;
    process.stdout.write("\x1b[" + col + "G");
    this.lastInputCursorLineIndex = cursor.lineIndex;
    this.inputCursorAnchor = "current";
  }

  private inputFrameWidth(): number {
    return Math.max(40, process.stdout.columns || 80);
  }

  private inputFrameContentWidth(): number {
    return Math.max(20, this.inputFrameWidth() - 4);
  }

  private inputFrameTop(): string {
    const b = getBorderChars();
    return b.tl + b.h.repeat(this.inputFrameContentWidth() + 2) + b.tr;
  }

  private inputFrameBottom(): string {
    const b = getBorderChars();
    return b.bl + b.h.repeat(this.inputFrameContentWidth() + 2) + b.br;
  }

  private inputCursorPosition(wrapped: { cursorRow: number; cursorCol: number; lines: string[] }): { lineIndex: number; columnText: string } {
    const visualCursorRow = wrapped.cursorRow - this.inputStartRow;
    return {
      lineIndex: 2 + visualCursorRow,
      columnText: " ".repeat(wrapped.cursorCol),
    };
  }

  private moveToInputContentStart(): void {
    const rowsUp = this.inputCursorAnchor === "bottom"
      ? this.lastInputContentLineCount + this.lastInputHintLineCount
      : Math.max(0, this.lastInputCursorLineIndex - 1);
    if (rowsUp > 0) {
      process.stdout.write("\x1b[" + rowsUp + "A");
    }
    this.lastInputCursorLineIndex = 0;
    this.inputCursorAnchor = "current";
  }

  private moveAfterInputFrame(): void {
    if (this.inputCursorAnchor === "current") {
      const rowsDown = Math.max(0, this.lastInputContentLineCount + this.lastInputHintLineCount - this.lastInputCursorLineIndex);
      if (rowsDown > 0) {
        process.stdout.write("\x1b[" + rowsDown + "B");
      }
    }
    process.stdout.write("\r");
    this.lastInputCursorLineIndex = 0;
    this.inputCursorAnchor = "current";
  }

  private writeInputValue(usePlaceholder = false): void {
    const contentWidth = this.inputFrameContentWidth();
    const uiMode = resolveGrokUiMode(
      this.chromeStatus.sessionMode,
      this.chromeStatus.permissionMode
    );
    const valueToWrap =
      this.input.value || (usePlaceholder ? modePlaceholder(uiMode) : "");
    const isPlaceholder = !this.input.value && usePlaceholder;

    const wrapWidth = contentWidth - 2;
    const wrapped = this.wrapInputVisualLines(valueToWrap, wrapWidth, isPlaceholder ? 0 : this.input.cursorPos);
    const compactDraft = this.shouldUseCompactDraft(this.input.value, wrapped.lines.length, isPlaceholder);

    const visibleCount = compactDraft ? 1 : Math.min(5, wrapped.lines.length);
    if (wrapped.cursorRow < this.inputStartRow) {
      this.inputStartRow = wrapped.cursorRow;
    } else if (wrapped.cursorRow >= this.inputStartRow + 5) {
      this.inputStartRow = wrapped.cursorRow - 4;
    }
    if (compactDraft) {
      this.inputStartRow = 0;
    } else {
      this.inputStartRow = Math.max(0, Math.min(this.inputStartRow, wrapped.lines.length - visibleCount));
    }

    const visibleLines = compactDraft
      ? [this.formatDraftChip(this.input.value)]
      : wrapped.lines.slice(this.inputStartRow, this.inputStartRow + visibleCount);

    // Grok 三态：角标 + 描边色分模式（原框内更新）
    const scrollUp =
      !compactDraft && this.inputStartRow > 0
        ? "▲ 更多内容 (当前第 " + (wrapped.cursorRow + 1) + " 行)"
        : "";
    const topLabel = modeInputTopLabel(uiMode, scrollUp);
    const scrollDown =
      !compactDraft && this.inputStartRow + visibleCount < wrapped.lines.length
        ? "▼ 更多内容 (共 " + wrapped.lines.length + " 行)"
        : "";
    // 无滚动时底边展示能力微文案，强化三态边界
    const bottomLabel = scrollDown || modeCapabilityFooter(uiMode);

    const frameWidth = contentWidth + 4;
    const b = getBorderChars();
    const topBorder = this.formatInputFrameBorder(b.tl, b.tr, topLabel, frameWidth);
    const bottomBorder = this.formatInputFrameBorder(b.bl, b.br, bottomLabel, frameWidth);

    const borderHex = modeBorderHex(uiMode);
    const borderPaint = (s: string) => fg(borderHex, s);
    const chunks: string[] = [borderPaint(topBorder)];
    const promptPrefix = modePromptPrefix(uiMode);

    for (let i = 0; i < visibleLines.length; i++) {
      const absoluteRow = this.inputStartRow + i;
      const prefix = compactDraft || absoluteRow === 0 ? promptPrefix : "  ";
      const textLine = visibleLines[i] ?? "";
      const rendered = truncateVisible(prefix + textLine, contentWidth);
      const padded = padVisible(rendered, contentWidth);
      const body = isPlaceholder ? S.d(padded) : S.b(padded);
      chunks.push("\n" + borderPaint(b.v + " ") + body + borderPaint(" " + b.v));
    }

    chunks.push("\n" + borderPaint(bottomBorder));

    let extraHint = "";
    if (compactDraft) {
      extraHint = S.y("多行草稿：Enter 发送全部内容");
    }
    if (extraHint) {
      chunks.push("\n" + extraHint);
    }

    const hints = this.formatCurrentSlashCompletionHints();
    for (const hint of hints) {
      chunks.push("\n" + DIM(hint));
    }

    process.stdout.write(chunks.join(""));

    this.lastInputContentLineCount = 1 + visibleLines.length + 1;
    this.lastInputHintLineCount = hints.length + (extraHint ? 1 : 0);

    const cursor = compactDraft
      ? { lineIndex: 2, columnText: " ".repeat(Math.min(contentWidth - 1, 2 + sw(this.formatDraftChip(this.input.value)))) }
      : this.inputCursorPosition(wrapped);
    this.lastInputCursorLineIndex = cursor.lineIndex;

    this.inputCursorAnchor = "bottom";
  }

  private formatCurrentSlashCompletionHints(): string[] {
    // 斜杠一律走切换器过滤，禁止输入框下方旧列表
    if (this.input.value.startsWith("/")) return [];
    if (this.overlay?.kind === "options" && this.overlay.filterable) return [];
    if (!this.isSlashCompletionActive(this.input.value)) return [];
    return [];
  }

  /** 打开可执行斜杠命令切换器（按 / 即开；保留 / 并可继续键入过滤） */
  openSlashCommandPicker(): void {
    if (!this.running) return;
    if (this.overlay?.kind === "options" && this.overlay.filterable) {
      // 已在斜杠切换器中：仅按当前输入重过滤
      this.refilterSlashPicker();
      return;
    }
    if (this.overlay?.kind === "options") return;
    this.streamActive = false;
    this.slashOutputActive = false;

    const openWith = (listFn: () => Array<{
      id: string;
      label: string;
      description: string;
      argumentHint: string;
    }>) => {
      const raw = listFn();
      if (!raw.length) return;
      // 保留 `/` 输入，可继续打 /he… 过滤
      if (!this.input.value.startsWith("/")) {
        this.input.clear();
        this.input.insertChar("/");
      }
      this.draftDisplaySource = null;
      this.slashCompletionSelectedIndex = 0;
      const mapped = raw.map((c) => ({
        id: c.id,
        label: c.label,
        description: c.argumentHint
          ? `${c.description}  ${c.argumentHint}`
          : c.description,
        _argumentHint: c.argumentHint,
      }));
      const filtered = this.filterSlashItems(mapped, this.input.value);
      this.showOptionPicker({
        title: "命令切换 · Slash",
        footerHint: "键入/粘贴检索 · 可带参数如 /dashboard web · ↑/↓ · Enter · Esc",
        filterable: true,
        items: filtered,
        onPick: (item) => {
          if (!item.id) return; // 无匹配占位
          const full = raw.find((c) => c.id === item.id);
          const needsArgs = Boolean(full?.argumentHint?.trim());
          // 执行后下一次 `/` 不自动弹切换器
          if (needsArgs) {
            this.input.clear();
            for (const ch of item.id + " ") {
              if (ch === "\n") this.input.insertNewline();
              else this.input.insertChar(ch);
            }
            this.draftDisplaySource = null;
            this.streamActive = false;
            this.redrawInput();
            return;
          }
          this.input.clear();
          this.draftDisplaySource = null;
          if (this.inputCallback) {
            void this.inputCallback(item.id);
          }
        },
      });
    };

    const ports = this.slashUi;
    const listFn = ports?.listExecutableSlashCommands;
    if (typeof listFn === "function") {
      openWith(listFn);
      return;
    }
    void import("../commands/index.js").then((mod) => {
      if (typeof mod.listExecutableSlashCommandsForPicker === "function") {
        if (this.slashUi) {
          this.slashUi.listExecutableSlashCommands =
            mod.listExecutableSlashCommandsForPicker;
        }
        openWith(mod.listExecutableSlashCommandsForPicker);
      }
    });
  }

  /**
   * 按输入检索最近命令 / skill：前缀匹配优先，其次包含匹配。
   * 空或仅 `/` 时返回全量（按名称排序）。
   *
   * 斜杠带参数：`/dashboard web` 只按命令名段 `dashboard` 过滤，
   * 避免参数 token 把合法命令滤成「无匹配」。
   * skill 切换器（无前导 /）：空格分 token 全匹配 id/label/desc。
   */
  private filterSlashItems(
    all: OptionPickerItem[],
    prefix: string
  ): OptionPickerItem[] {
    const raw = prefix.trim();
    const p = raw.toLowerCase();
    if (!p || p === "/") {
      return [...all].sort((a, b) => a.id.localeCompare(b.id));
    }

    // 斜杠命令：过滤键 = 命令名（第一段），忽略后续参数
    const isSlashCmd = raw.startsWith("/");
    const cmdHead = isSlashCmd
      ? raw.split(/\s+/)[0]!.toLowerCase()
      : p;
    const rest = cmdHead.replace(/^\//, "").trim();
    const freeTokens = isSlashCmd
      ? []
      : p.split(/\s+/).filter(Boolean);

    const scored: Array<{ item: OptionPickerItem; score: number }> = [];
    for (const it of all) {
      const id = it.id.toLowerCase();
      const label = it.label.toLowerCase();
      const desc = (it.description || "").toLowerCase();
      const hay = `${id} ${label} ${desc}`;
      let score = -1;
      if (id === cmdHead || id === `/${rest}` || label === rest || label === cmdHead) {
        score = 100;
      } else if (id.startsWith(cmdHead) || id.startsWith(`/${rest}`)) {
        score = 90 - Math.min(20, id.length - Math.min(id.length, cmdHead.length));
      } else if (id.includes(cmdHead) || label.startsWith(rest)) score = 70;
      else if (label.includes(rest) || desc.includes(rest)) score = 40;
      else if (
        freeTokens.length > 1 &&
        freeTokens.every((t) => hay.includes(t))
      ) {
        score = 55;
      } else if (
        freeTokens.length === 1 &&
        (id.includes(freeTokens[0]!) ||
          label.includes(freeTokens[0]!) ||
          desc.includes(freeTokens[0]!))
      ) {
        score = 45;
      }
      if (score >= 0) scored.push({ item: it, score });
    }
    scored.sort(
      (a, b) =>
        b.score - a.score || a.item.id.localeCompare(b.item.id)
    );
    return scored.map((s) => s.item);
  }

  /** 斜杠切换器打开时：按当前输入重过滤并原地重画 */
  private refilterSlashPicker(): void {
    if (this.overlay?.kind !== "options" || !this.overlay.filterable) return;
    const all = this.overlay.allItems ?? this.overlay.items;
    const filtered = this.filterSlashItems(all, this.input.value);
    // 无匹配时显示空列表提示项，不回退全量（避免「越打字越乱」）
    this.overlay.items =
      filtered.length > 0
        ? filtered
        : [{ id: "", label: "(无匹配)", description: "继续输入或 Backspace" }];
    this.overlay.selected = 0;
    this.paintOverlay(true);
  }

  private isSlashCompletionPrefix(value: string): boolean {
    const text = value.trim();
    return text.startsWith("/") && !/\s/.test(text);
  }

  private isSlashCompletionActive(value: string): boolean {
    return value.startsWith("/") && (!/\s/.test(value.trim()) || /\s$/.test(value));
  }

  private acceptSlashCompletion(): boolean {
    if (!this.isSlashCompletionPrefix(this.input.value)) return false;
    const ports = this.slashUi;
    if (!ports) {
      void this.slashUiPromise;
      return false;
    }
    const matches = ports.findSlashCompletion(this.input.value, 8);
    const completion = matches[this.slashCompletionSelectedIndex] ?? matches[0];
    if (!completion) return false;
    this.input.value = completion.name + " ";
    this.input.cursorPos = this.input.value.length;
    this.draftDisplaySource = null;
    this.slashCompletionSelectedIndex = 0;
    this.lastEmptyCtrlCAt = 0;
    this.redrawInput();
    return true;
  }

  private moveSlashCompletionSelection(delta: number): boolean {
    if (!this.isSlashCompletionPrefix(this.input.value)) return false;
    const ports = this.slashUi;
    if (!ports) {
      void this.slashUiPromise;
      return false;
    }
    const matches = ports.findSlashCompletion(this.input.value, 8);
    if (matches.length <= 1) return false;
    this.slashCompletionSelectedIndex =
      (this.slashCompletionSelectedIndex + delta + matches.length) % matches.length;
    this.redrawInput();
    return true;
  }

  showPrompt(): void {
    if (!this.running) return;
    // 浮层（切换器）占用输入槽时禁止再叠一份输入框
    if (this.overlay) {
      this.streamActive = false;
      return;
    }
    this.inputStartRow = 0;
    this.streamActive = false;
    this.slashOutputActive = false;
    // slash 执行后清掉残留的单独 `/`
    this.clearInputIfSlashResidue();
    // 已有活动输入框时只重绘，避免任务结束后再叠一份空框
    if (this.promptLive) {
      this.redrawInput();
      return;
    }
    process.stdout.write("\n");
    this.printPromptHint();
    this.writeInputValue(true);
    this.syncCursor();
    this.promptLive = true;
    // slash 输出后恢复 contiguous=false（上面已有对话）
    this.chromeContiguous = false;
  }

  /** slash 执行后：输入仅为 `/` 时清空 */
  clearInputIfSlashResidue(): void {
    if (this.input.value === "/" || this.input.value.trim() === "/") {
      this.input.clear();
      this.draftDisplaySource = null;
      this.slashCompletionSelectedIndex = 0;
    }
  }

  /** 测试与 slash 复用：当前是否默认展开长工具输出 */
  getExpandLongToolOutput(): boolean {
    return this.expandLongToolOutput;
  }

  // ── 键盘输入处理 ─────────────────────────────────

  private setupInput(): void {
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
    }

    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    this.resizeHandler = () => {
      // 任务流式期禁止；输入态才重绘
      if (this.running && !this.streamActive) {
        this.redrawInput();
      }
    };
    process.stdout.on("resize", this.resizeHandler);

    let partial = "";
    let bracketedPaste = false;
    let pasteSawCarriageReturn = false;

    this.dataHandler = (chunk: string) => {
      if (!this.running) return;
      // Ctrl+\ → 会话切换器（Grok 风格入口）
      if (chunk === "\x1c") {
        partial = "";
        this.handleSessionPickerToggle();
        return;
      }
      if (this.recoveryState?.status === "paused" && !this.input.value && !this.overlay && /^[rsec]$/i.test(chunk)) {
        const action = ({ r: "retry", s: "next", e: "edit", c: "cancel" } as const)[chunk.toLowerCase() as "r" | "s" | "e" | "c"];
        this.inputCallback?.(`/recover ${action}`);
        return;
      }
      // 裸 Esc：浮层打开时对标 JumpRestore dismiss（勿吞键）
      if (chunk === "\x1b") {
        partial = "";
        if (this.overlay) {
          this.dismissOverlay();
        }
        return;
      }

      // 非 bracketed 粘贴：多字符纯文本整块插入（含单行 /dashboard web）
      if (!bracketedPaste && !chunk.includes("\x1b") && chunk.length > 1) {
        const normalized = chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        // 管道/自动化输入中的单行尾换行代表 Enter，不应被识别成多行粘贴草稿。
        if (!process.stdin.isTTY && normalized.endsWith("\n")) {
          const line = normalized.replace(/\n+$/, "");
          if (!line.includes("\n") && (!this.overlay || this.isFilterableOverlay())) {
            if (line) this.insertBulkText(line);
            if (this.overlay) this.handleOverlayEnter();
            else this.handleEnter();
            return;
          }
        }
        // 允许 filterable 浮层粘贴；其它浮层拒绝
        if (!this.overlay || this.isFilterableOverlay()) {
          this.insertBulkText(normalized);
          return;
        }
      }

      for (const ch of chunk) {
        if (!partial && ch === "\x1b") {
          partial = ch;
          continue;
        }

        const seq = partial + ch;
        if (seq === "\x1b[200~") {
          partial = "";
          bracketedPaste = true;
          pasteSawCarriageReturn = false;
        } else if (seq === "\x1b[201~") {
          partial = "";
          bracketedPaste = false;
          pasteSawCarriageReturn = false;
          this.afterPasteCommit();
        } else if (seq === "\x1b[" || /^\x1b\[\d*(?:;\d*)?$/.test(seq)) {
          partial = seq;
        } else if (bracketedPaste) {
          partial = "";
          // filterable / 无浮层：写入；其它浮层丢弃粘贴内容
          if (this.overlay && !this.isFilterableOverlay()) {
            continue;
          }
          if (seq === "\r") {
            if (this.isFilterableOverlay()) this.input.insertChar(" ");
            else this.input.insertNewline();
            pasteSawCarriageReturn = true;
          } else if (seq === "\n") {
            if (!pasteSawCarriageReturn) {
              if (this.isFilterableOverlay()) this.input.insertChar(" ");
              else this.input.insertNewline();
            }
            pasteSawCarriageReturn = false;
          } else if (ch >= " " || ch === "\t") {
            pasteSawCarriageReturn = false;
            this.input.insertChar(ch);
          }
        } else if (seq === "\r" || seq === "\n") {
          partial = "";
          if (this.overlay) this.handleOverlayEnter();
          else this.handleEnter();
        } else if (seq === " ") {
          partial = "";
          this.handleSpaceKey();
        } else if (seq === "\t") {
          partial = "";
          this.handleTab();
        } else if (seq === "\x1b[Z") {
          partial = "";
          if (this.overlay) return;
          this.handleShiftTab();
        } else if (seq === "\x16") {
          // Ctrl+V：从系统剪贴板粘贴（Windows Terminal 右键粘贴走 bracketed；Ctrl+V 常发此码）
          partial = "";
          void this.pasteFromClipboard();
        } else if (seq === "\x03") {
          partial = "";
          if (this.overlay) {
            this.closeOverlay(undefined, true);
            return;
          }
          this.handleCtrlC();
        } else if (seq === "\x7f") {
          partial = "";
          if (this.overlay && !(this.overlay.kind === "options" && this.overlay.filterable)) {
            return;
          }
          this.handleBackspace();
        } else if (seq === "\x01") {
          partial = "";
          if (this.overlay) return;
          this.handleCtrlA();
        } else if (seq === "\x05") {
          partial = "";
          if (this.overlay) return;
          this.handleCtrlE();
        } else if (seq === "\x15") {
          partial = "";
          if (this.overlay) return;
          this.handleCtrlU();
        } else if (seq === "\x0b") {
          partial = "";
          if (this.overlay) return;
          this.handleCtrlK();
        } else if (seq === "\x17") {
          partial = "";
          if (this.overlay) return;
          this.handleCtrlW();
        } else if (seq === "\x1a") {
          partial = "";
          if (this.overlay) return;
          this.handleCtrlZ();
        } else if (seq === "\x0c") {
          partial = "";
          this.handleCtrlL();
        } else if (seq === "\x04") {
          partial = "";
          if (this.overlay) {
            this.closeOverlay(undefined, true);
            return;
          }
          this.handleCtrlD();
        } else if (seq === "\x1b[A") {
          partial = "";
          if (this.overlay) this.moveOverlaySelection(-1);
          else if (this.focus === "scrollback") this.navigateTurns(-1);
          else this.handleHistoryUp();
        } else if (seq === "\x1b[B") {
          partial = "";
          if (this.overlay) this.moveOverlaySelection(1);
          else if (this.focus === "scrollback") this.navigateTurns(1);
          else this.handleHistoryDown();
        } else if (seq === "\x1b[5~" || seq === "\x1b[1;2A") {
          partial = "";
          this.navigateTurns(-1);
        } else if (seq === "\x1b[6~" || seq === "\x1b[1;2B") {
          partial = "";
          this.navigateTurns(1);
        } else if (seq === "\x1b[1;3A" || seq === "\x1b[1;5A" || seq === "\x1b[5A") {
          partial = "";
          if (this.overlay) this.moveOverlaySelection(-1);
          else this.handleLineUp();
        } else if (seq === "\x1b[1;3B" || seq === "\x1b[1;5B" || seq === "\x1b[5B") {
          partial = "";
          if (this.overlay) this.moveOverlaySelection(1);
          else this.handleLineDown();
        } else if (seq === "\x1b[3~") {
          partial = "";
          if (this.overlay && !this.isFilterableOverlay()) return;
          this.handleDelete();
        } else if (seq === "\x1bd" || seq === "\x1b[3;5~" || seq === "\x1b[3;3~") {
          partial = "";
          if (this.overlay && !this.isFilterableOverlay()) return;
          this.handleAltD();
        } else if (seq === "\x1bb" || seq === "\x1b[1;3D" || seq === "\x1b[1;5D" || seq === "\x1b[5D") {
          partial = "";
          // filterable 浮层：词级左移仍作用于输入草稿
          if (this.overlay && !this.isFilterableOverlay()) return;
          this.handleWordLeft();
        } else if (seq === "\x1bf" || seq === "\x1b[1;3C" || seq === "\x1b[1;5C" || seq === "\x1b[5C") {
          partial = "";
          if (this.overlay && !this.isFilterableOverlay()) return;
          this.handleWordRight();
        } else if (seq === "\x1b[C") {
          partial = "";
          // ↑↓ 管列表；←→ 在 filterable 时编辑输入（否则吞掉避免误触）
          if (this.overlay && !this.isFilterableOverlay()) return;
          this.handleRight();
        } else if (seq === "\x1b[D") {
          partial = "";
          if (this.overlay && !this.isFilterableOverlay()) return;
          this.handleLeft();
        } else if (seq === "\x1b[H" || seq === "\x1b[1~") {
          partial = "";
          if (this.overlay && !this.isFilterableOverlay()) return;
          this.handleHome();
        } else if (seq === "\x1b[F" || seq === "\x1b[4~") {
          partial = "";
          if (this.overlay && !this.isFilterableOverlay()) return;
          this.handleEnd();
        } else if (seq === "\x0f") {
          partial = "";
          if (this.overlay) return;
          this.handleCtrlO();
        } else if (seq === "\x0e") {
          partial = "";
          if (this.overlay) return;
          this.handleNewline();
        } else if (seq === "\x12") {
          partial = "";
          if (this.overlay) return;
          this.handleHistorySearch();
        } else if (seq === "\x1c") {
          partial = "";
          this.handleSessionPickerToggle();
        } else if (ch >= " " || ch === "\t") {
          partial = "";
          // 斜杠切换器可键入过滤；其它浮层吞掉可打印键
          if (this.overlay && !(this.overlay.kind === "options" && this.overlay.filterable)) {
            return;
          }
          this.handleChar(ch);
        } else {
          partial = "";
        }
      }
    };
    process.stdin.on("data", this.dataHandler);
  }

  private handleEnter(): void {
    const cmd = this.input.value.trim();
    if (!cmd) return;
    this.lastEmptyCtrlCAt = 0;
    // 仅 `/` → 打开命令切换器（不提交）
    if (cmd === "/") {
      if (this.slashUi) this.openSlashCommandPicker();
      else void this.slashUiPromise.then(() => this.openSlashCommandPicker());
      return;
    }
    this.submitSlashDraft(cmd);
  }

  /**
   * 提交斜杠/普通命令草稿（关闭浮层后的统一出口）。
   * 供 handleEnter 与 filterable 浮层「带参数 Enter」共用。
   */
  private submitSlashDraft(cmd: string): void {
    const text = cmd.trim();
    if (!text) return;
    if (this.overlay) {
      this.closeOverlay(undefined, false);
    }
    this.focus = "prompt";
    // 写入草稿再 submit，保证进历史
    this.input.clear();
    for (const ch of text) {
      if (ch === "\n") this.input.insertNewline();
      else this.input.insertChar(ch);
    }
    this.inputStartRow = 0;
    this.moveAfterInputFrame();
    process.stdout.write("\n");
    this.promptLive = false;
    this.streamActive = true;
    this.input.submit();
    this.draftDisplaySource = null;
    if (this.inputCallback) {
      void this.inputCallback(text);
    }
  }

  /** 粘贴结束后：filterable 重过滤，否则重画输入 */
  private afterPasteCommit(): void {
    this.markPastedDraft();
    if (this.isFilterableOverlay()) {
      this.refilterSlashPicker();
      return;
    }
    this.redrawInput();
  }

  /** 向输入区批量插入文本（粘贴 / Ctrl+V） */
  private insertBulkText(text: string): void {
    if (!text) return;
    // 非 filterable 浮层：不允许粘贴进输入
    if (this.overlay && !this.isFilterableOverlay()) return;
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (const ch of normalized) {
      if (ch === "\n") {
        // 斜杠过滤框内换行无意义，压成空格
        if (this.isFilterableOverlay()) this.input.insertChar(" ");
        else this.input.insertNewline();
      } else if (ch >= " " || ch === "\t") {
        this.input.insertChar(ch);
      }
    }
    this.afterPasteCommit();
  }

  /**
   * Ctrl+V 剪贴板粘贴。
   * Windows: PowerShell Get-Clipboard；其它: pbpaste / xclip（有则用）。
   * 失败时静默（用户仍可用终端右键 / Ctrl+Shift+V 的 bracketed paste）。
   */
  private async pasteFromClipboard(): Promise<void> {
    if (this.overlay && !this.isFilterableOverlay()) return;
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      let text = "";
      if (process.platform === "win32") {
        const { stdout } = await execFileAsync(
          "powershell.exe",
          ["-NoProfile", "-Command", "Get-Clipboard -Raw"],
          { encoding: "utf8", timeout: 3000, windowsHide: true }
        );
        text = String(stdout ?? "");
      } else if (process.platform === "darwin") {
        const { stdout } = await execFileAsync("pbpaste", [], {
          encoding: "utf8",
          timeout: 3000,
        });
        text = String(stdout ?? "");
      } else {
        try {
          const { stdout } = await execFileAsync(
            "xclip",
            ["-selection", "clipboard", "-o"],
            { encoding: "utf8", timeout: 3000 }
          );
          text = String(stdout ?? "");
        } catch {
          const { stdout } = await execFileAsync(
            "xsel",
            ["--clipboard", "--output"],
            { encoding: "utf8", timeout: 3000 }
          );
          text = String(stdout ?? "");
        }
      }
      // 去掉结尾多余换行；filterable 内整段粘贴
      text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (this.isFilterableOverlay()) {
        text = text.replace(/\n+/g, " ").trimEnd();
      }
      if (text) this.insertBulkText(text);
    } catch {
      // 静默：依赖终端原生粘贴
    }
  }

  private handleTab(): void {
    // 浮层占用输入槽时 Tab 不触发 agents（对标 jump_slot_taken）
    if (this.overlay) {
      if (this.overlay.kind === "turns") {
        this.focusPromptFromScrollback();
      }
      return;
    }
    // 对标 Grok：空输入 Tab = FocusScrollback
    const next = tabStructuralFocus(
      { focus: this.focus, overlay: "none" },
      !this.input.value.trim()
    );
    if (next === "scrollback") {
      // 有用户轮 → 轮次浏览；尚无轮次则保留原 /agents 入口
      if (this.turnLog.length > 0) {
        this.openTurnBrowse(0);
        return;
      }
    }
    if (next === "prompt") {
      this.focusPromptFromScrollback();
      return;
    }
    // 非空：slash 补全；空且未进 scrollback 时保留 /agents
    if (!this.input.value) {
      this.lastEmptyCtrlCAt = 0;
      process.stdout.write("\n");
      if (this.inputCallback) {
        this.inputCallback("/agents");
      }
      return;
    }

    if (this.acceptSlashCompletion()) {
      return;
    }

    this.appendFeedbackAndRedraw(S.y("Tab agents 仅在空输入时打开；当前草稿已保留，补全未启用"));
  }

  private handleShiftTab(): void {
    this.lastEmptyCtrlCAt = 0;
    // 不 leave 输入框、不提交 slash：只在原框内换 Mode/Perm 外观
    if (this.onModeCycle) {
      void this.onModeCycle();
      return;
    }
    // 无 handler 时回退为 slash（会离开输入区）
    this.moveAfterInputFrame();
    process.stdout.write("\n");
    if (this.inputCallback) {
      this.inputCallback("/mode cycle");
    }
  }

  private handleCtrlC(): void {
    if (!this.input.value) {
      const now = this.now();
      const shouldExit =
        this.lastEmptyCtrlCAt > 0 &&
        now - this.lastEmptyCtrlCAt <= this.doubleCtrlCExitWindowMs;
      this.lastEmptyCtrlCAt = shouldExit ? 0 : now;

      if (shouldExit) {
        process.stdout.write("\n" + DIM("再次 Ctrl+C 已确认退出") + "\n");
        if (this.inputCallback) {
          this.inputCallback("exit");
        }
        return;
      }

      this.appendFeedbackAndRedraw(S.r("^C") + " " + DIM("再次 Ctrl+C 退出，或输入 exit"), true);
      return;
    }

    this.lastEmptyCtrlCAt = 0;
    this.lastClearedDraft = this.input.value;
    this.lastClearedDraftDisplaySource = this.draftDisplaySource;
    this.input.clear();
    this.draftDisplaySource = null;
    this.inputStartRow = 0;
    this.appendFeedbackAndRedraw(S.r("^C") + " " + DIM("草稿已清空，Ctrl+Z 恢复"), true);
  }

  private handleCtrlZ(): void {
    if (this.input.value) {
      this.appendFeedbackAndRedraw(S.y("当前输入不会被覆盖，草稿未恢复"));
      return;
    }

    if (!this.lastClearedDraft) {
      this.appendFeedbackAndRedraw(S.y("没有可恢复的草稿"), true);
      return;
    }

    for (const ch of this.lastClearedDraft) {
      if (ch === "\n") {
        this.input.insertNewline();
      } else {
        this.input.insertChar(ch);
      }
    }
    this.draftDisplaySource = this.lastClearedDraftDisplaySource;
    this.lastClearedDraft = null;
    this.lastClearedDraftDisplaySource = null;
    this.appendFeedbackAndRedraw(S.g("已恢复草稿"));
  }

  private handleCtrlA(): void {
    this.input.moveStart();
    this.redrawInput();
  }

  private handleCtrlE(): void {
    this.input.moveEnd();
    this.redrawInput();
  }

  private handleBackspace(): void {
    if (this.overlay?.kind === "options" && this.overlay.filterable) {
      const before = this.input.value;
      const beforeCursor = this.input.cursorPos;
      this.input.backspace();
      if (this.input.value === before && this.input.cursorPos === beforeCursor) {
        this.syncCursor();
        return;
      }
      if (!this.input.value) {
        // Esc 式关掉：下次 `/` 可再开切换器
        this.closeOverlay(undefined, true);
        return;
      }
      this.refilterSlashPicker();
      return;
    }
    const beforeValue = this.input.value;
    const beforeCursor = this.input.cursorPos;
    this.input.backspace();
    if (this.input.value === beforeValue && this.input.cursorPos === beforeCursor) {
      this.syncCursor();
      return;
    }
    this.resetDraftDisplaySourceIfEmpty();
    this.slashCompletionSelectedIndex = 0;
    this.redrawInput();
  }

  private handleCtrlU(): void {
    if (this.overlay?.kind === "options" && this.overlay.filterable) return;
    this.input.deleteBeforeCursor();
    this.resetDraftDisplaySourceIfEmpty();
    this.redrawInput();
  }

  private handleCtrlK(): void {
    this.input.deleteAfterCursor();
    this.resetDraftDisplaySourceIfEmpty();
    this.redrawInput();
  }

  private handleCtrlW(): void {
    this.input.deleteWordBeforeCursor();
    this.resetDraftDisplaySourceIfEmpty();
    this.redrawInput();
  }

  private handleAltD(): void {
    this.input.deleteWordAfterCursor();
    this.resetDraftDisplaySourceIfEmpty();
    this.redrawInput();
  }

  private handleDelete(): void {
    const beforeValue = this.input.value;
    const beforeCursor = this.input.cursorPos;
    this.input.deleteAfterCursorChar();
    if (this.input.value === beforeValue && this.input.cursorPos === beforeCursor) {
      this.syncCursor();
      return;
    }
    this.resetDraftDisplaySourceIfEmpty();
    this.redrawInput();
  }

  private handleCtrlL(): void {
    this.repaintChrome({ clearScreen: true });
  }

  /**
   * 主题 / Ctrl+L：整页刷新。
   * 清屏用 Node TTY API + CSI（含 Windows Terminal 的 3J 清 scrollback）。
   */
  repaintChrome(options: { clearScreen?: boolean } = {}): void {
    if (!this.running) return;
    this.streamActive = false;
    if (this.overlay) {
      this.overlay = null;
      this.jumpRestore = null;
      this.focus = "prompt";
    }
    if (options.clearScreen !== false) {
      this.clearViewport();
    }
    this.chromeContiguous = true;
    this.printHeader();
    this.printInputBar();
    this.syncCursor();
  }

  /** 尽量可靠地清空当前视口（Windows ConPTY 友好） */
  private clearViewport(): void {
    const out = process.stdout;
    try {
      if (typeof out.cursorTo === "function") {
        out.cursorTo(0, 0);
      } else {
        out.write("\x1b[H");
      }
      if (typeof out.clearScreenDown === "function") {
        out.clearScreenDown();
      } else {
        out.write("\x1b[0J");
      }
    } catch {
      // fall through to CSI
    }
    // 2J=清屏 3J=清回滚（WT）H=回原点
    out.write("\x1b[2J\x1b[3J\x1b[H");
  }

  private handleCtrlO(): void {
    const expanded = this.toggleExpandLongToolOutput();
    const state = expanded ? "展开后续工具输出" : "折叠后续工具输出";
    this.appendFeedbackAndRedraw(S.s("长输出：") + DIM(state), !this.input.value);
  }

  private handleCtrlD(): void {
    if (this.input.value) {
      this.appendFeedbackAndRedraw(S.y("非空输入不会退出，草稿已保留"));
      return;
    }
    this.lastEmptyCtrlCAt = 0;
    if (this.inputCallback) {
      this.inputCallback("exit");
    }
  }

  private handleHistoryUp(): void {
    if (this.moveSlashCompletionSelection(-1)) return;
    this.input.historyUp();
    this.draftDisplaySource = this.input.value ? "typed" : null;
    this.redrawInput();
  }

  private handleHistoryDown(): void {
    if (this.moveSlashCompletionSelection(1)) return;
    this.input.historyDown();
    this.draftDisplaySource = this.input.value ? "typed" : null;
    this.redrawInput();
  }

  private handleHistorySearch(): void {
    const matched = this.input.searchHistory();
    if (!matched) {
      this.appendFeedbackAndRedraw(S.y("无匹配历史"));
      return;
    }
    this.draftDisplaySource = this.input.value ? "typed" : null;
    this.redrawInput();
  }

  private handleLeft(): void {
    this.input.moveLeft();
    this.syncCursor();
  }

  private handleRight(): void {
    this.input.moveRight();
    this.syncCursor();
  }

  private handleWordLeft(): void {
    this.input.moveWordLeft();
    this.syncCursor();
  }

  private handleWordRight(): void {
    this.input.moveWordRight();
    this.syncCursor();
  }

  private handleLineUp(): void {
    this.input.moveLineUp();
    this.syncCursor();
  }

  private handleLineDown(): void {
    this.input.moveLineDown();
    this.syncCursor();
  }

  private handleHome(): void {
    this.input.moveStart();
    this.redrawInput();
  }

  private handleEnd(): void {
    this.input.moveEnd();
    this.redrawInput();
  }

  /**
   * 空格键语义（对标 Grok panes + filterable slash）：
   * 1. filterable 切换器（斜杠 / skill）：插入空格并重过滤（可搜多词）
   * 2. sessions / 非 filterable options：吞掉，绝不误关切换器
   * 3. turns 浮层或纯 scrollback 焦点：Space → FocusPrompt
   * 4. 其余：正常插入
   */
  private handleSpaceKey(): void {
    if (this.overlay?.kind === "options" && this.overlay.filterable) {
      this.handleChar(" ");
      return;
    }
    // 必须先于 scrollback 判断：非 filterable options 的 focus 也是 scrollback
    if (this.overlay?.kind === "sessions" || this.overlay?.kind === "options") {
      return;
    }
    if (this.overlay?.kind === "turns" || this.focus === "scrollback") {
      this.focusPromptFromScrollback("输入焦点");
      return;
    }
    this.handleChar(" ");
  }

  private handleChar(ch: string): void {
    // 斜杠 / 技能等 filterable 切换器：键入即在切换器内检索（含空格）
    if (this.overlay?.kind === "options" && this.overlay.filterable) {
      this.input.insertChar(ch);
      if (this.draftDisplaySource !== "pasted") {
        this.draftDisplaySource = "typed";
      }
      this.refilterSlashPicker();
      return;
    }

    this.input.insertChar(ch);
    if (this.draftDisplaySource !== "pasted") {
      this.draftDisplaySource = "typed";
    }
    this.slashCompletionSelectedIndex = 0;

    // 每次输入恰好为 `/`：立刻打开切换器（可继续键入过滤）
    if (this.input.value === "/") {
      this.openSlashCommandPicker();
      return;
    }
    this.redrawInput();
  }

  private handleNewline(): void {
    this.input.insertNewline();
    if (this.draftDisplaySource !== "pasted") {
      this.draftDisplaySource = "typed";
    }
    this.redrawInput();
  }

  // ── G1 浮层：会话切换 / 轮次浏览 ───────────────────

  private handleSessionPickerToggle(): void {
    if (this.overlay?.kind === "sessions") {
      this.dismissOverlay();
      return;
    }
    // 互斥：先关掉 turns 再开 sessions（对标 jump_slot_taken）
    if (this.overlay) this.closeOverlay(undefined, true);
    this.openSessionPicker();
  }

  private moveOverlaySelection(delta: number): void {
    if (!this.overlay || this.overlay.items.length === 0) return;
    const n = this.overlay.items.length;
    this.overlay.selected = (this.overlay.selected + delta + n) % n;
    if (this.overlay.kind === "turns") {
      this.turnSelected = this.overlay.selected;
    }
    this.paintOverlay(true);
  }

  private handleOverlayEnter(): void {
    if (!this.overlay) return;
    if (this.overlay.kind === "sessions") {
      const item = this.overlay.items[this.overlay.selected];
      this.closeOverlay(undefined, false); // 确认选择：不回旧 focus 书签
      this.focus = "prompt";
      if (item) void this.onSessionPick?.(item.sessionId);
      return;
    }
    if (this.overlay.kind === "options") {
      // 斜杠切换器：输入已含参数时提交完整草稿（如 /dashboard web）
      // 不能只 onPick 选中项，否则参数永远丢失
      const filterable = Boolean(this.overlay.filterable);
      const draftBefore = this.input.value.trim();
      if (filterable && draftBefore.startsWith("/") && /\s+\S/.test(draftBefore)) {
        this.submitSlashDraft(draftBefore);
        return;
      }
      const item = this.overlay.items[this.overlay.selected];
      const onPick = this.overlay.onPick;
      this.closeOverlay(undefined, false);
      this.focus = "prompt";
      if (item && item.id && onPick) {
        void Promise.resolve(onPick(item)).catch(() => {
          // onPick 错误不抛到键盘路径
        });
      } else if (filterable && draftBefore.startsWith("/") && draftBefore.length > 1) {
        // 无有效选中项：若草稿是完整斜杠命令仍提交
        this.submitSlashDraft(draftBefore);
      }
      return;
    }
    // turns: 回显选中轮次摘要后回 prompt（对标 jump Enter 落点后可继续输入）
    const turn = this.overlay.items[this.overlay.selected];
    const full = turn ? this.turnLog[turn.index]?.fullText : null;
    this.closeOverlay(undefined, false);
    this.focus = "prompt";
    if (full) {
      this.moveAfterInputFrame();
      process.stdout.write("\n" + S.s(`↩ 轮次 #${(turn?.index ?? 0) + 1}`) + "\n");
      for (const line of full.split("\n").slice(0, 12)) {
        process.stdout.write(S.d(line) + "\n");
      }
      this.writeInputValue(true);
      this.syncCursor();
    }
  }

  private navigateTurns(delta: number): void {
    if (
      this.overlay?.kind === "sessions" ||
      this.overlay?.kind === "turns" ||
      this.overlay?.kind === "options"
    ) {
      this.moveOverlaySelection(delta);
      return;
    }
    // 有草稿时不抢键（对标 prompt 编辑优先）
    if (this.input.value.trim()) return;
    this.openTurnBrowse(delta);
  }

  /** 进入 scrollback 焦点 + 轮次浮层（Grok FocusScrollback 的轻量等价） */
  private openTurnBrowse(delta = 0): void {
    const items: TurnBrowseItem[] = this.turnLog.map((t, index) => ({
      index,
      preview: t.preview,
    }));
    this.armJumpRestore();
    this.focus = "scrollback";
    let selected = items.length > 0 ? items.length - 1 : 0;
    if (items.length > 0 && delta < 0) {
      selected = Math.max(0, items.length - 2);
    }
    this.turnSelected = selected;
    this.overlay = {
      kind: "turns",
      items,
      selected,
      lineCount: 0,
      blockLines: 0,
    };
    this.paintOverlay(false);
  }

  private focusPromptFromScrollback(hint = "输入焦点"): void {
    if (this.overlay) {
      this.closeOverlay(hint, false);
    }
    this.focus = "prompt";
    this.jumpRestore = null;
  }

  /**
   * 浮层块布局（append-only 终端）：
   *   [overlay lines]
   *   [input frame + optional hints]
   * 光标在 input 内容行。↑/↓ 必须从块顶整段擦除再画，否则会叠出多份面板。
   */
  private eraseOverlayBlock(): void {
    if (!this.overlay || this.overlay.blockLines <= 0) return;

    // 从当前光标精确回到块首行（面板 top），再 \x1b[J 清到屏尾。
    // input 行号：1=顶边, 2=首行内容, …；hints 接在底边之后。
    // 块绝对行：1..lineCount 面板，lineCount+1.. 输入框(+hints)。
    let rowsUp: number;
    if (this.inputCursorAnchor === "bottom") {
      // 光标在块最末行 → 上移 blockLines-1 到面板 top
      rowsUp = Math.max(1, this.overlay.blockLines - 1);
    } else {
      const cursorLine = Math.max(1, this.lastInputCursorLineIndex);
      // 绝对行 = lineCount + cursorLine；到 top(1) 需上移 abs-1
      rowsUp = Math.max(1, this.overlay.lineCount + cursorLine - 1);
    }
    process.stdout.write("\x1b[" + rowsUp + "A\r\x1b[J");
    this.lastInputCursorLineIndex = 0;
    this.inputCursorAnchor = "current";
    this.overlay.blockLines = 0;
  }

  private paintOverlay(replace = false): void {
    if (!this.overlay) return;
    const width = process.stdout.columns || 80;
    let plain: string[];
    let painted: string;
    if (this.overlay.kind === "sessions") {
      plain = formatSessionPickerPanel(this.overlay.items, this.overlay.selected, width);
      painted = paintSessionPickerPanel(plain, this.overlay.selected);
    } else if (this.overlay.kind === "options") {
      plain = formatOptionPickerPanel(
        this.overlay.title,
        this.overlay.items,
        this.overlay.selected,
        width,
        this.overlay.footerHint
      );
      painted = paintOptionPickerPanel(plain);
    } else {
      plain = formatTurnBrowsePanel(this.overlay.items, this.overlay.selected, width);
      painted = paintTurnBrowsePanel(plain, this.overlay.selected);
    }
    const lineCount = plain.length;

    if (replace && this.overlay.blockLines > 0) {
      this.eraseOverlayBlock();
    } else if (this.overlay.blockLines > 0) {
      // 同一次会话内重开：仍按块擦
      this.eraseOverlayBlock();
    } else {
      // 首次打开：擦掉活动输入框，或 Enter 后残留的「命令+补全」块
      this.clearInputChromeForOverlay();
    }

    // 面板 lineCount 行 + trailing \n 后接输入框
    process.stdout.write(painted + "\n");
    this.writeInputValue(!this.input.value);
    const inputBlock =
      this.lastInputContentLineCount + this.lastInputHintLineCount;
    this.overlay.lineCount = lineCount;
    // block = 面板行 + 输入框(+hints) 行；光标经 syncCursor 回到内容行
    this.overlay.blockLines = lineCount + inputBlock;
    this.syncCursor();
    this.promptLive = true;
  }

  /**
   * @param restoreJump 对标 restore_jump_viewport：Esc 取消时恢复 focus/选中
   */
  private closeOverlay(hint?: string, restoreJump = true): void {
    if (!this.overlay) return;
    const wasOptions = this.overlay.kind === "options";
    if (this.overlay.blockLines > 0) {
      this.eraseOverlayBlock();
    } else {
      process.stdout.write("\r\x1b[J");
    }
    this.overlay = null;

    if (restoreJump && this.jumpRestore) {
      this.turnSelected = this.jumpRestore.turnSelected;
      this.focus = "prompt";
    } else {
      this.focus = "prompt";
    }
    this.jumpRestore = null;

    // Esc 取消命令切换器：清空残留 `/`（不强制 suppress，方便马上再按 / 打开）
    if (wasOptions && restoreJump) {
      if (this.input.value === "/" || this.input.value.trim() === "") {
        this.input.clear();
      }
    }

    if (hint) {
      process.stdout.write(DIM(hint) + "\n");
    }
    this.writeInputValue(!this.input.value);
    this.syncCursor();
    this.promptLive = true;
    this.streamActive = false;
  }

  // ── 工具块渲染 ────────────────────────────────────

  private printToolHeader(tool: string, command: string, status: "running" | "success" | "error", durationMs = 0): void {
    const w = process.stdout.columns || 100;
    const row = formatToolTimelineRow({ tool, command, status, durationMs, width: w });
    const color = status === "error" ? S.r : status === "success" ? S.g : S.m;
    process.stdout.write("\n" + color(row));
  }

  private printToolOutput(output: string, _status: "success" | "error"): void {
    if (output.trim()) {
      this.lastToolOutputBlob = output;
    }
    const card = formatToolOutputCard(output, {
      expand: this.expandLongToolOutput,
      maxTop: 8,
      maxBottom: 2,
      longThreshold: 12,
    });
    const chunks: string[] = [];
    for (const line of card.displayLines) {
      chunks.push("  " + DIM(line) + "\n");
    }
    if (card.footer) {
      chunks.push("  " + DIM(card.footer) + "\n");
    }
    if (chunks.length > 0) {
      process.stdout.write(chunks.join(""));
    }
  }

  // ── 事件输出（全部 append，不清屏） ────────────────
  // 任务执行中一律 ensureStreamMode：只往下追加，禁止重画输入框。

  appendToolStart(tool: string, command: string): void {
    this.ensureStreamMode();
    this.clearProgressLine();
    this.currentToolRunning = true;
    process.stdout.write("\n" + S.m(formatRoleHeader("executing")));
    this.printToolHeader(tool, command, "running");
  }

  appendToolSuccess(tool: string, command: string, output: string, durationMs: number): void {
    this.ensureStreamMode();
    this.clearProgressLine();
    if (this.currentToolRunning) {
      this.currentToolRunning = false;
    }
    this.printToolHeader(tool, command, "success", durationMs);
    process.stdout.write("\n");
    if (output.trim()) {
      this.printToolOutput(output, "success");
    }
  }

  appendToolError(tool: string, command: string, error: string, durationMs: number): void {
    this.ensureStreamMode();
    this.clearProgressLine();
    if (this.currentToolRunning) {
      this.currentToolRunning = false;
    }
    this.printToolHeader(tool, command, "error", durationMs);
    process.stdout.write("\n  " + S.r("Error: ") + S.r(error.split("\n")[0]) + "\n");
    const rest = error.split("\n");
    if (rest.length > 1) {
      this.printToolOutput(rest.slice(1).join("\n"), "error");
    }
  }

  appendThinking(text: string): void {
    this.ensureStreamMode();
    this.clearProgressLine();
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return;
    process.stdout.write("\n" + S.p(formatRoleHeader("assistant")) + "\n");
    process.stdout.write(lines[0]);
    for (let i = 1; i < lines.length; i++) {
      process.stdout.write("\n" + lines[i]);
    }
  }

  appendCogitated(durationMs: number): void {
    this.ensureStreamMode();
    this.clearProgressLine();
    process.stdout.write("\n" + DIM("◆ Cogitated for " + fmtDur(durationMs)));
  }

  appendValidation(status: "pass" | "fail" | "warn", text: string): void {
    const icon = status === "pass" ? S.g("●") : status === "fail" ? S.r("●") : S.y("●");
    const label = status === "pass" ? S.g("pass") : status === "fail" ? S.r("fail") : S.y("warn");
    const line = icon + " " + label + "  " + S.d(text);
    // 空闲输入态：离开输入框再写，避免盖住底边
    // 任务流式态：只追加一行（执行阶段事件极多，绝不能每条都重画输入框）
    this.appendFeedbackAndRedraw(line, !this.input.value);
  }

  appendOutput(text: string): void {
    this.ensureStreamMode();
    const lines = text.split("\n");
    for (const line of lines) {
      process.stdout.write(line.trim() ? "\n" + S.b("› ") + line : "\n");
    }
  }

  /**
   * Slash 多行输出：先擦掉输入框（避免「空框还在 + 正文 + 新框」），再只追加文本。
   */
  appendSlashLine(text: string = ""): void {
    if (!this.running) return;
    if (this.overlay) {
      this.closeOverlay(undefined, false);
    }
    // 首行：擦掉当前/刚提交残留的输入框，不留 orphan
    if (!this.slashOutputActive) {
      if (this.promptLive) {
        this.backToPrompt();
      } else {
        this.eraseSubmittedInputBlock();
      }
      this.slashOutputActive = true;
    }
    this.streamActive = true;
    this.promptLive = false;
    if (this.input.value === "/" || this.input.value.trim() === "/") {
      this.input.clear();
    }
    process.stdout.write(String(text ?? "") + "\n");
  }

  /**
   * 单行本地提示（模式切换等）。多行 slash 报告请用 appendSlashLine。
   */
  appendNotice(text: string): void {
    if (!this.running) return;
    const msg = String(text ?? "").trim();
    if (!msg) return;
    // 已在 slash 流式输出中：只追加一行
    if (this.streamActive && !this.promptLive) {
      process.stdout.write(S.d(msg) + "\n");
      return;
    }
    if (this.overlay) return;

    const painted = S.d(msg);
    if (this.promptLive) {
      this.moveAfterInputFrame();
      process.stdout.write("\n" + painted + "\n");
      // 不要带 slash 补全地重画：先清掉单独的 /
      if (this.input.value === "/") this.input.clear();
      this.writeInputValue(!this.input.value);
      this.syncCursor();
      this.promptLive = true;
      return;
    }
    process.stdout.write("\n" + painted + "\n");
    if (this.input.value === "/") this.input.clear();
    this.writeInputValue(true);
    this.syncCursor();
    this.promptLive = true;
    this.streamActive = false;
  }

  appendUserInput(text: string): void {
    this.ensureStreamMode();
    const lines = text.split("\n");
    process.stdout.write("\n" + S.s(formatRoleHeader("user")) + "\n");
    for (const line of lines) {
      process.stdout.write(line + "\n");
    }
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 64);
    this.turnLog.push({ preview: preview || "(空)", fullText: text });
    if (this.turnLog.length > 40) this.turnLog.shift();
  }

  /**
   * 会话切换/恢复后：把已 hydrate 的 messages 回放到终端，并重建 turnLog。
   * - 先擦掉当前输入框，避免叠出多份输入框
   * - 过滤 Token 预算 nudge、纯 tool 占位助手行
   * - 可选 statusLine 与最终输入框一次画完（调用方勿再 appendValidation）
   */
  replaySessionMessages(
    messages: Array<{
      role?: string;
      content?: unknown;
      tool_calls?: Array<{ function?: { name?: string } }>;
    }>,
    options: {
      maxMessages?: number;
      label?: string;
      /** 回放末尾状态行（如 ● pass 已切换…），与输入框一并绘制 */
      statusLine?: string;
      /** 默认 true；false 时不画输入框（极少用） */
      drawInput?: boolean;
    } = {}
  ): void {
    const maxMessages = Math.max(4, Math.min(options.maxMessages ?? 24, 60));
    const label = options.label?.trim() || "已载入会话内容";
    const drawInput = options.drawInput !== false;

    // 换会话必须丢掉上一会话的轮次索引
    this.turnLog = [];
    this.turnSelected = 0;

    const dialog = (Array.isArray(messages) ? messages : [])
      .map((m) => {
        const role = String(m?.role || "");
        if (role !== "user" && role !== "assistant") return null;
        const text = this.formatReplayMessageText(m);
        if (!text.trim()) return null;
        if (role === "user" && isInternalUserNoise(text)) return null;
        if (role === "assistant" && isToolOnlyAssistantText(text)) return null;
        return { role: role as "user" | "assistant", text };
      })
      .filter((m): m is { role: "user" | "assistant"; text: string } => m !== null);

    // 擦掉当前输入框，历史接在顶栏/既有 scrollback 下，最后只画一次输入框
    this.backToPrompt();
    process.stdout.write(S.s(`── ${label} ──`) + "\n");

    if (dialog.length === 0) {
      process.stdout.write(DIM("(该会话暂无可显示的对话消息)") + "\n");
    } else {
      const hidden = Math.max(0, dialog.length - maxMessages);
      if (hidden > 0) {
        process.stdout.write(
          DIM(`(仅显示最近 ${maxMessages} 条对话，另有 ${hidden} 条已折叠；模型上下文仍完整)`) + "\n"
        );
      }

      const slice = dialog.slice(-maxMessages);
      for (const msg of slice) {
        if (msg.role === "user") {
          const lines = msg.text.split("\n");
          process.stdout.write("\n" + S.s(formatRoleHeader("user")) + "\n");
          for (const line of this.clipReplayLines(lines, 24)) {
            process.stdout.write(line + "\n");
          }
          const preview = msg.text.replace(/\s+/g, " ").trim().slice(0, 64);
          this.turnLog.push({ preview: preview || "(空)", fullText: msg.text });
          if (this.turnLog.length > 40) this.turnLog.shift();
        } else {
          this.writeReplayAssistant(msg.text);
        }
      }
    }

    process.stdout.write("\n" + DIM("── 以上为历史回放；继续输入即可在该会话上下文中对话 ──") + "\n");
    if (options.statusLine?.trim()) {
      process.stdout.write(options.statusLine.trim() + "\n");
    }
    if (drawInput) {
      this.writeInputValue(!this.input.value);
      this.syncCursor();
      this.promptLive = true;
      this.streamActive = false;
    } else {
      this.promptLive = false;
      this.streamActive = true;
    }
  }

  private formatReplayMessageText(message: {
    content?: unknown;
    tool_calls?: Array<{ function?: { name?: string } }>;
  }): string {
    if (typeof message.content === "string" && message.content.trim()) {
      return message.content;
    }
    if (message.content != null && typeof message.content !== "string") {
      try {
        return JSON.stringify(message.content);
      } catch {
        return String(message.content);
      }
    }
    const tools = message.tool_calls;
    if (Array.isArray(tools) && tools.length > 0) {
      return tools
        .map((tc) => `[tool] ${tc?.function?.name || "call"}`)
        .join(", ");
    }
    return "";
  }

  private clipReplayLines(lines: string[], maxLines: number): string[] {
    if (lines.length <= maxLines) return lines;
    const head = Math.max(1, Math.floor(maxLines * 0.7));
    const tail = Math.max(1, maxLines - head - 1);
    return [
      ...lines.slice(0, head),
      DIM(`… 省略 ${lines.length - head - tail} 行 …`),
      ...lines.slice(-tail),
    ];
  }

  /**
   * 回放助手消息：走与 appendFinal 相同的 Markdown 渲染（含表格），
   * 避免历史里 `| col |` 原样倾倒、表格错位。
   */
  private writeReplayAssistant(text: string): void {
    const width = process.stdout.columns || 100;
    const mdWidth = Math.max(40, width - 4);
    process.stdout.write("\n" + S.p(formatRoleHeader("assistant")) + "\n");
    const mdLines = formatMarkdownForTerminal(text, { width: mdWidth });
    // 含表格时提高行上限，尽量不把 ┌─┬─┐ 结构从中间截断
    const hasTable =
      /\|.+\|/.test(text) ||
      mdLines.some((line) => /[┌┬┐├┼┤└┴┘]/.test(line.replace(/\x1b\[[0-9;]*m/g, "")));
    const maxLines = hasTable ? 100 : 48;
    for (const line of this.clipReplayLines(mdLines, maxLines)) {
      // Markdown 渲染已带色；勿再包一层 S.b 以免表格边框/对齐观感变差
      process.stdout.write(line + "\n");
    }
  }

  appendFinal(text: string): void {
    this.ensureStreamMode();
    this.clearProgressLine();
    const width = process.stdout.columns || 100;
    const mdWidth = Math.max(40, width - 4);
    const mdLines = formatMarkdownForTerminal(text, { width: mdWidth });
    process.stdout.write("\n" + S.p(BOLD(formatRoleHeader("assistant"))) + "  " + S.g(BOLD("结果")) + "\n");
    const box = formatResultHighlight({
      header: "结果",
      lines: mdLines,
      width,
    });
    for (let i = 0; i < box.length; i++) {
      const line = box[i];
      // 顶/底与左右边框用强调色；正文保留 Markdown 原色
      if (i === 0 || i === box.length - 1) {
        process.stdout.write(S.g(BOLD(line)) + "\n");
      } else if (line.startsWith("│ ") && line.endsWith(" │")) {
        const mid = line.slice(2, line.length - 2);
        process.stdout.write(S.g("│ ") + mid + S.g(" │") + "\n");
      } else {
        process.stdout.write(S.g(line) + "\n");
      }
    }
  }

  appendError(text: string): void {
    this.appendFeedbackAndRedraw(S.r("● error") + "  " + S.r(text), !this.input.value);
  }

  appendState(from: string, to: string): void {
    this.ensureStreamMode();
    this.clearProgressLine();
    process.stdout.write(
      "\n" + DIM("[state] ") + S.y(from) + " " + DIM("→") + " " + S.g(to) + "\n"
    );
  }

  appendDone(durationMs: number): void {
    this.ensureStreamMode();
    this.clearProgressLine();
    const dur = fmtDur(durationMs);
    process.stdout.write("\n" + S.g(BOLD("☑ 任务完成")) + "  " + S.p(dur) + "\n");
  }

  appendRepair(reason: string, action: string, retryCount: number): void {
    this.ensureStreamMode();
    this.clearProgressLine();
    process.stdout.write("\n" + S.y("[repair]"));
    process.stdout.write("\n  " + S.d("原因:") + " " + S.r(reason));
    process.stdout.write("\n  " + S.d("动作:") + " " + S.b(action));
    process.stdout.write("\n  " + S.d("retry:") + " " + S.y(String(retryCount)) + "\n");
  }
}
