# 轻灵 TUI 高拟真 Shell Implementation Plan

## 1. RED Tests

- 新增 `tests/unit/tui-shell.test.mjs`，断言纯 formatter 输出包含目标图关键元素。
- 扩展 `tests/unit/streaming-tui-ctrl-c.test.mjs`，验证启动/重绘路径输出新版 top bar、输入框和底部 hints，并保留草稿。
- 扩展 `tests/unit/streaming-repl-queue.test.mjs`，验证普通 prompt 渲染用户角色块，slash 命令不渲染用户角色块。

## 2. Formatter

- 新增 `src/tui/shell.ts`，实现纯字符串 formatter。
- 通过 `string-width` 处理中英文宽度和窄屏截断。
- 将工具名映射为中文动作：`read`/`browser_fetch` 为读取文件，`list`/`search` 为读取目录，`bash` 为执行命令，未知工具保留原名。
- 输入框、结果框和 top bar 均在小宽度下降级为可读文本。

## 3. StreamUI Integration

- `printHeader()` 使用 `formatTopBar()`，保留纯终端输出。
- `printInputBar()` / `showPrompt()` 使用 `formatInputFrame()` 和 `formatBottomHints()`。
- `writeInputValue()` 渲染边框内的实时输入行，避免输入框 placeholder 与裸 prompt 同时出现。
- `syncCursor()` 按边框内 `│ › ` 前缀重新计算光标列。
- 新增 `appendUserInput(text)`，由 REPL 对普通 prompt 调用。
- `appendThinking()`、`appendToolStart()`、`appendToolSuccess()`、`appendToolError()`、`appendFinal()`、`appendDone()` 切换为目标图角色/时间线风格。
- 保留现有快捷键行为、输入缓冲、多行、历史、Ctrl+O 长输出折叠。

## 4. Status Snapshot

- `StreamUI` 保存可选 chrome snapshot：workspace、model、ready、tokens、branch、version。
- `StreamingREPL.refreshStatusLine()` 在构建状态线后尽量同步 tokens/branch 到 chrome snapshot；失败时使用安全默认值。
- 不改变 statusline API 对外语义。

## 5. Verification

- 运行 targeted tests：
  `npm run build && node --test tests\\unit\\tui-shell.test.mjs tests\\unit\\streaming-tui-ctrl-c.test.mjs tests\\unit\\streaming-repl-queue.test.mjs`
- 运行全量：
  `npm run ci:check`
- 运行静态检查：
  旧英文命名扫描、`git diff --check`、高危依赖审计。
  `git diff --check`
  `npm audit --registry=https://registry.npmjs.org --audit-level=high`

## 6. GitHub

- 检查 staged diff 不含旧英文名和敏感文件。
- 提交 `feat: replicate qling tui shell`。
- 推送 `origin main` 并验证远端 head。
