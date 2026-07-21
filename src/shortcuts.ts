export interface ShortcutDefinition {
  id: string;
  key: string;
  behavior: string;
  /** Include this definition in the README contract table. */
  document: boolean;
}

/** Single source of truth for runtime help and README shortcut validation. */
export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  { id: "enter", key: "Enter", behavior: "发送当前输入", document: true },
  {
    id: "tab",
    key: "Tab",
    behavior: "空输入且有轮次时进入 managed scrollback；无轮次时打开 /agents；slash 前缀补全；其他草稿保留并提示",
    document: true,
  },
  { id: "shift-tab", key: "Shift+Tab", behavior: "循环 normal → plan → auto(Always-approve) → normal，并保留草稿", document: true },
  { id: "slash", key: "Slash (/)", behavior: "显示本地命令候选；Tab 补全，不自动执行", document: false },
  { id: "ctrl-n", key: "Ctrl+N", behavior: "插入换行，继续编辑多行 prompt", document: true },
  { id: "ctrl-r", key: "Ctrl+R", behavior: "搜索本会话内输入历史，未命中时保留草稿", document: true },
  { id: "ctrl-a-e", key: "Ctrl+A / Ctrl+E", behavior: "移动到输入开头 / 结尾", document: true },
  { id: "word-move", key: "Alt+←/→, Alt+B/F", behavior: "按词移动光标", document: false },
  { id: "vertical-move", key: "Alt+↑/↓", behavior: "在多行输入内按列上下移动", document: false },
  { id: "ctrl-u-k", key: "Ctrl+U / Ctrl+K", behavior: "删除光标前 / 后的输入内容", document: true },
  { id: "delete", key: "Delete", behavior: "删除光标后的一个字符", document: false },
  { id: "word-delete", key: "Ctrl+W / Alt+D", behavior: "删除光标前 / 后的一个词", document: false },
  { id: "ctrl-l", key: "Ctrl+L", behavior: "清空当前终端视图并重绘输入栏，不丢弃正在编辑的内容", document: true },
  { id: "ctrl-c", key: "Ctrl+C", behavior: "非空输入时清空；空输入时再次 Ctrl+C 确认退出", document: true },
  { id: "ctrl-z", key: "Ctrl+Z", behavior: "恢复最近一次被 Ctrl+C 清空的本地草稿", document: true },
  { id: "ctrl-d", key: "Ctrl+D", behavior: "空输入时退出；非空输入时保留草稿并提示", document: true },
  { id: "escape", key: "Esc", behavior: "关闭浮层并恢复焦点与草稿；不提交输入", document: true },
  { id: "exit", key: "/exit, /quit, /q, /退出", behavior: "本地退出 TUI，不调用模型、不写入输入历史", document: false },
  { id: "home-end", key: "Home / End", behavior: "移动到输入开头 / 结尾", document: false },
  { id: "history", key: "↑ / ↓", behavior: "浮层中导航；输入区切换历史并恢复未发送草稿", document: true },
  { id: "left-right", key: "← / →", behavior: "移动光标", document: false },
  { id: "ctrl-o", key: "Ctrl+O", behavior: "切换后续长工具输出的展开 / 折叠显示", document: true },
  { id: "ctrl-backslash", key: "Ctrl+\\", behavior: "打开 / 关闭会话切换器", document: true },
  { id: "scrollback-nav", key: "PgUp / PgDn", behavior: "在 managed scrollback 当前轮内翻页", document: true },
  { id: "scrollback-return", key: "Space / i", behavior: "从 managed scrollback 返回输入焦点", document: false },
  { id: "paste", key: "Paste", behavior: "bracketed paste 写入输入缓冲，多行粘贴不会自动发送", document: false },
] as const;

export const README_SHORTCUT_ROWS = SHORTCUT_DEFINITIONS
  .filter((entry) => entry.document)
  .map(({ key, behavior }) => ({ key, behavior }));

export const SHORTCUT_LINES = [
  "",
  "⌨️ 【TUI 快捷键】",
  "-----------------------------------------",
  "界面入口 : /help slash 查看本地命令；/privacy 查看边界；/context 查看上下文；/statusline 查看状态线",
  ...SHORTCUT_DEFINITIONS.map((entry) => `${entry.key.padEnd(18)}: ${entry.behavior}`),
  "/sessions · /resume : 打开会话切换器；/resume latest 恢复最近；/sessions list 纯列表",
  "/expand last       : 重放并展开最近一次工具输出",
  "/queue             : 查看本地输入队列；/queue clear 清空 pending，不取消当前任务",
  "-----------------------------------------",
  "说明: 这些快捷键只作用于本地 TUI 输入缓冲；历史搜索不上传、不持久化。",
  "",
];
