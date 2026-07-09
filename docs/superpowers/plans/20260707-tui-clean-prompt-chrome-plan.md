# 轻灵 TUI 输入区简洁化实施计划

## 顺序

1. 添加 RED 测试：
   - `formatBottomHints()` 输出短提示，不含 `/model 切换模型`、`/exit 退出` 等长尾信息。
   - `printInputBar()` 和 `showPrompt()` 不再输出原始 `model=... session=...` 状态串。
   - Ctrl+L 重绘仍保留输入草稿和输入框完整边框。
2. 修改 `src/tui/shell.ts` 与 `src/i18n/zh-cn.ts`：
   - 将默认 bottom hint 缩短为一行。
   - 从 `formatWelcomeGuide()` 删除 `3 步开始` 和 `常用入口`。
3. 修改 `src/tui/streaming-tui.ts`：
   - 去掉 prompt 前原始 statusline 打印。
   - 继续保留 `setStatusLine()` API。
4. 验证：
   - `npm run build`
   - `node --test tests\unit\tui-shell.test.mjs tests\unit\streaming-tui-ctrl-c.test.mjs`
   - `git diff --check`
   - 旧英文名扫描。

## 风险控制

- 不触碰 `InputBuffer`。
- 不触碰多行粘贴 compact chip 逻辑。
- 不修改 slash completion 目录和命令执行语义。
- 不修改 `src/onboarding/tutorial.ts` 的独立 onboarding 文案。
