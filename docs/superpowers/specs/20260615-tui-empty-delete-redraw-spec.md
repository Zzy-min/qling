# 轻灵 TUI 空输入 Delete 清屏回归修复规范

## Problem

空白输入状态下按 Delete，会把输入框上方的欢迎信息、状态线等内容清掉，只剩输入框。用户截图显示 Delete 后上方内容被擦除。

## Root Cause

`inputCursorPosition()` 已修正为让第一条内容行的 `lineIndex = 2`，但 `moveToInputContentStart()` 在 `inputCursorAnchor === "current"` 时仍直接上移 `lastInputCursorLineIndex` 行。光标位于第一条内容行时，上移 2 行会越过输入框顶边框，随后 `\x1b[J` 会从输入框上方开始清屏。

## Requirements

- 空输入按 Delete 不应清除输入框上方内容。
- 非空输入重绘、Ctrl+L、Backspace、Delete、slash 面板重绘仍保持原行为。
- 不改变输入提交语义或快捷键语义。

## Acceptance

- 新增回归测试：空输入 `printInputBar()` 后按 Delete，只允许从顶边框开始重绘，不允许出现 `\x1b[2A\r\x1b[J` 这类越界清屏序列。
- 定向 TUI 测试通过。
- 完整 CI 通过。
