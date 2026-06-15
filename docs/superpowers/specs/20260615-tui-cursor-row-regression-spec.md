# 轻灵 TUI 光标行错位回归修复规范

## Problem

用户在输入框为空或输入后看到光标落在输入框顶边框上，而不是内容行内。截图中光标位于 `┌──` 这一行，实际应位于 `│ › ... │` 内容行。

## Root Cause

多行输入框加入顶边框和底边框后，`inputCursorPosition()` 仍把第一条内容行的行号计算为 `1`。但当前渲染结构是：

```text
line 1: top border
line 2: first content row
line 3: bottom border
```

因此第一条内容行的目标行号必须是 `2`，否则 `syncCursor()` 从底边框回退时会上移到顶边框。

## Requirements

- 空 placeholder 状态下，光标必须定位到内容行。
- 普通输入、中文宽字符输入、多行滚动窗口必须继续定位到当前可见内容行。
- 不改变输入提交、补全、历史导航、Ctrl+C/Ctrl+N 等行为。

## Acceptance

- 增加回归测试，断言首屏 `printInputBar()` 后的光标移动序列不会从底边框上移 2 行。
- 定向 TUI 测试通过。
- `npm run build` 通过。
