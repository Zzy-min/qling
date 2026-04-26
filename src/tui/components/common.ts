// ============================================================
// 轻灵 TUI - 共享常量（所有组件共用）
// ============================================================

import { C, S } from "../styles/theme.js";

// 图标（使用兼容的 Unicode 符号，终端友好）
export const C2 = {
  icons: {
    wind: "🌬",
    tool: "🔧",
    token: "◆",
    context: "▣",
    netOk: "●",
    netErr: "✕",
    user: "👤",
    agent: "🤖",
    plan: "📋",
    check: "✓",
    fail: "✕",
    repair: "↻",
    pass: "✓",
    waiting: "○",
    running: "◐",
    valPass: "✓",
    valFail: "✕",
    valPartial: "◐",
    thinking: "�",
    search: "🔍",
    memory: "🧠",
    session: "📁",
    cmd: "⌘",
    keyboard: "⌨",
    file: "📄",
    folder: "📁",
    spark: "✨",
    warn: "⚠",
    error: "⛔",
    info: "ℹ",
    star: "★",
    clock: "⏱",
    rounds: "◷",
    strategy: "🎯",
    eye: "👁",
    signal: "▒",
    up: "↑",
    down: "↓",
    left: "←",
    right: "→",
    enter: "↵",
    esc: "esc",
    tab: "⇥",
    space: "␣",
  },

  // 侧边栏宽度
  SIDEBAR_W: 28,

  // 状态栏前缀（用于填满宽度）
  statusPrefix: " ",
};

// 侧边栏命令列表
export const SIDEBAR_COMMANDS = [
  { id: "sessions", label: "Sessions", icon: "📁", shortcut: "1" },
  { id: "project", label: "Project", icon: "📁", shortcut: "2" },
  { id: "commands", label: "Commands", icon: "⌘", shortcut: "3" },
];

export const SIDEBAR_ITEMS = [
  { id: "sessions", label: "会话列表", icon: "📁", shortcut: "1" },
  { id: "project", label: "当前项目", icon: "📂", shortcut: "2" },
  { id: "commands", label: "快捷命令", icon: "⌘", shortcut: "3" },
  { id: "plan", label: "/plan", icon: "📋", shortcut: "p" },
  { id: "run", label: "/run", icon: "▶", shortcut: "r" },
  { id: "reset", label: "/reset", icon: "↺", shortcut: "x" },
  { id: "tools", label: "/tools", icon: "🔧", shortcut: "t" },
  { id: "memory", label: "/memory", icon: "🧠", shortcut: "m" },
  { id: "debug", label: "/debug", icon: "🐛", shortcut: "d" },
  { id: "compact", label: "/compact", icon: "📦", shortcut: "c" },
];

// 快捷命令 Palette 条目
export const COMMAND_PALETTE_ITEMS = [
  { id: "cmd-plan", label: "制定计划", icon: "📋", description: "分析任务并制定执行计划", command: "/plan", shortcut: "p", category: "agent" as const },
  { id: "cmd-run", label: "立即执行", icon: "▶", description: "运行当前计划", command: "/run", shortcut: "r", category: "agent" as const },
  { id: "cmd-reset", label: "重置会话", icon: "↺", description: "清空当前对话历史", command: "/reset", shortcut: "x", category: "session" as const },
  { id: "cmd-tools", label: "查看工具", icon: "🔧", description: "列出所有可用工具", command: "/tools", shortcut: "t", category: "agent" as const },
  { id: "cmd-memory", label: "查看记忆", icon: "🧠", description: "查看当前上下文记忆", command: "/memory", shortcut: "m", category: "agent" as const },
  { id: "cmd-debug", label: "调试模式", icon: "🐛", description: "开启详细调试输出", command: "/debug", shortcut: "d", category: "system" as const },
  { id: "cmd-compact", label: "压缩上下文", icon: "📦", description: "手动压缩对话上下文", command: "/compact", shortcut: "c", category: "system" as const },
  { id: "cmd-quit", label: "退出", icon: "👋", description: "退出轻灵", command: "/quit", shortcut: "q", category: "system" as const },
];
