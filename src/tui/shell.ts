import { default as stringWidth } from "string-width";
import { getLocalizedText } from "../i18n/index.js";

export interface TopBarSnapshot {
  productName?: string;
  englishName?: string;
  version?: string;
  workspace: string;
  model: string;
  ready?: boolean;
  tokens?: number;
  branch?: string | null;
  width?: number;
}

export type RoleKind = "user" | "assistant" | "executing";

export interface ToolTimelineEvent {
  tool: string;
  command: string;
  status: "running" | "success" | "error";
  durationMs?: number;
  width?: number;
}

export interface InputFrameOptions {
  placeholder: string;
  value?: string;
  width?: number;
}

const sw = (value: string): number => stringWidth(value);

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

export function visibleWidth(value: string): number {
  return sw(stripAnsi(value));
}

export function padVisible(value: string, width: number): string {
  const padding = Math.max(0, width - visibleWidth(value));
  return value + " ".repeat(padding);
}

export function truncateVisible(value: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (visibleWidth(value) <= maxWidth) return value;
  let width = 0;
  let index = 0;
  for (const char of value) {
    const nextWidth = sw(char);
    if (width + nextWidth > maxWidth - 1) break;
    width += nextWidth;
    index += char.length;
  }
  return value.slice(0, index) + "…";
}

function normalizeLabel(value: string | null | undefined, fallback = "-"): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeWidth(width: number | undefined): number {
  if (!Number.isFinite(width)) return 100;
  return Math.max(40, Math.floor(Number(width)));
}

function formatTokenCount(tokens: number | undefined): string {
  const value = Math.max(0, Number.isFinite(tokens) ? Number(tokens) : 0);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.floor(value));
}

function formatDuration(durationMs: number | undefined): string {
  const value = Math.max(0, Math.floor(Number(durationMs ?? 0)));
  if (value <= 0) return "";
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function workspaceName(workspace: string): string {
  const normalized = normalizeLabel(workspace).replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? normalized;
}

export function formatTopBar(snapshot: TopBarSnapshot): string[] {
  const width = normalizeWidth(snapshot.width);
  const product = normalizeLabel(snapshot.productName, "轻灵");
  const english = normalizeLabel(snapshot.englishName, "Qling");
  const version = normalizeLabel(snapshot.version, "0.0.0").replace(/^v/i, "");
  const left = `${product} ${english} v${version}`;
  const workspace = `Workspace: ${workspaceName(snapshot.workspace)}`;
  const model = `Model: ${normalizeLabel(snapshot.model, "unknown")}`;
  const ready = `${snapshot.ready === false ? "○" : "●"} ${snapshot.ready === false ? "忙碌" : "就绪"}`;
  const tokens = `Tokens: ${formatTokenCount(snapshot.tokens)}`;
  const branch = `Git: ${normalizeLabel(snapshot.branch, "-")}`;
  const parts = [left, workspace, model, ready, tokens, branch];

  let line = parts[0];
  for (const part of parts.slice(1)) {
    const separator = "    ";
    if (visibleWidth(line + separator + part) > width) {
      line += "  " + part;
    } else {
      line += separator + part;
    }
  }

  return [truncateVisible(line, width), "─".repeat(width)];
}

export function formatRoleHeader(role: RoleKind): string {
  if (role === "user") return "👤  You";
  if (role === "executing") return "◌  正在执行...";
  return "✦  轻灵";
}

function extractTarget(tool: string, command: string): string {
  const text = normalizeLabel(command, "");
  const normalized = tool.toLowerCase();
  if (normalized.includes("bash") || normalized.includes("shell") || normalized.includes("exec")) {
    return text;
  }
  const quoted = text.match(/["']([^"']+)["']$/)?.[1];
  if (quoted) return quoted;
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.at(-1) ?? text;
}

function toolAction(tool: string, command: string): string {
  const t = getLocalizedText();
  const tl = t.tui?.timeline || {};
  const normalized = tool.toLowerCase();
  if (normalized.includes("search") || normalized.includes("list") || /(^|\s)(ls|dir|find)(\s|$)/i.test(command)) {
    return tl.readDir || "读取目录";
  }
  if (normalized.includes("read") || normalized.includes("fetch") || normalized.includes("file")) {
    return tl.readFile || "读取文件";
  }
  if (normalized.includes("bash") || normalized.includes("shell") || normalized.includes("exec")) {
    return tl.execCmd || "执行命令";
  }
  if (normalized.includes("write") || normalized.includes("edit")) {
    return tl.writeFile || "写入文件";
  }
  return tl.toolCall || tool || "工具调用";
}

export function formatToolTimelineRow(event: ToolTimelineEvent): string {
  const width = normalizeWidth(event.width);
  const icon = event.status === "error" ? "×" : event.status === "success" ? "✓" : "│";
  const action = toolAction(event.tool, event.command);
  const target = extractTarget(event.tool, event.command);
  const duration = formatDuration(event.durationMs);
  const base = `${icon}  ${action}    ${target}`;
  if (!duration) return truncateVisible(base, width);
  const room = width - visibleWidth(base) - visibleWidth(duration);
  if (room > 2) return `${base}${" ".repeat(room)}${duration}`;
  return truncateVisible(`${base}  ${duration}`, width);
}

export function formatResultBox(lines: string[], width: number, options?: { compactLong?: boolean }): string[] {
  const safeWidth = normalizeWidth(width);
  const contentWidth = Math.max(20, safeWidth - 4);
  let normalizedLines = lines.length > 0 ? lines : [""];

  const t = getLocalizedText();
  const lo = t.tui?.longOutput || {} as any;

  // P1: 长输出避免信息墙 (默认对 >8 行的结果启用紧凑模式)
  const doCompact = options?.compactLong !== false && normalizedLines.length > 8;
  if (doCompact) {
    const head = normalizedLines.slice(0, 4);
    const tail = normalizedLines.slice(-2);
    const note = `${lo.collapsed || "... (长输出已折叠)"} (${normalizedLines.length} ${lo.lines || "行"})`;
    normalizedLines = [...head, note, ...tail];
  }

  const top = "┌" + "─".repeat(contentWidth + 2) + "┐";
  const body = normalizedLines.map((line) => {
    const text = truncateVisible(line, contentWidth);
    return `│ ${padVisible(text, contentWidth)} │`;
  });
  const bottom = "└" + "─".repeat(contentWidth + 2) + "┘";
  return [top, ...body, bottom];
}

export function formatInputFrame(options: InputFrameOptions): string[] {
  const t = getLocalizedText();
  const safeWidth = normalizeWidth(options.width);
  const contentWidth = Math.max(20, safeWidth - 4);
  const value = options.value && options.value.length > 0
    ? options.value
    : (options.placeholder || "输入任务，或按 / 打开命令面板");
  const inputLine = `› ${value}`;
  return [
    "┌" + "─".repeat(contentWidth + 2) + "┐",
    `│ ${padVisible(truncateVisible(inputLine, contentWidth), contentWidth)} │`,
    "└" + "─".repeat(contentWidth + 2) + "┘",
  ];
}

export function formatBottomHints(): string {
  const t = getLocalizedText();
  return t.tui?.hints?.bottom || "Enter 发送   Ctrl+N 换行   粘贴多行先编辑   Ctrl+C 清空/中断   /model 切换模型   /exit 退出";
}

export interface HomeSnapshot {
  model?: string;
  workspace?: string;
  memoryStatus?: string;
  permissionMode?: string;
  recentSessions?: string[];
  width?: number;
}

export function formatWelcomeGuide(width = 80, snapshot?: HomeSnapshot): string[] {
  const t = getLocalizedText();
  const safeWidth = normalizeWidth(width || snapshot?.width);
  const home = t.tui?.home || {} as any;

  const model = snapshot?.model || "unknown";
  const ws = snapshot?.workspace ? workspaceName(snapshot.workspace) : "-";
  const mem = snapshot?.memoryStatus || "本地";
  const perm = snapshot?.permissionMode || "ask";

  const lines: string[] = [
    truncateVisible(`${home.title || "轻灵 · 本地工作台"}`, safeWidth),
    truncateVisible(`${home.model || "模型"}: ${model}   ${home.workspace || "工作区"}: ${ws}`, safeWidth),
    truncateVisible(`${home.memoryStatus || "记忆"}: ${mem}   ${home.permissionMode || "权限"}: ${perm}`, safeWidth),
  ];

  if (snapshot?.recentSessions && snapshot.recentSessions.length > 0) {
    const rec = snapshot.recentSessions.slice(0, 2).join(" | ");
    lines.push(truncateVisible(`${home.recentSessions || "最近会话"}: ${rec}`, safeWidth));
  }

  lines.push(truncateVisible("3 步开始: 输入任务 → 按 / 打开命令面板 → /doctor 检查环境", safeWidth));
  lines.push(truncateVisible(`常用入口 : /help · /privacy · /context · /doctor · ${home.recommended || "推荐命令"}`, safeWidth));

  return lines;
}
