# 轻灵 TUI 输入框右侧边框分离回归修复规范

## Problem

用户在 Windows Terminal / PowerShell 中启动 `qling` 后，输入框右侧竖线与顶/底边框分离。现象表现为内容行的右边框比顶边框和底边框更靠右。

## Root Cause

多行输入增强中新增的动态边框函数传入了 `contentWidth + 2` 作为总宽度，但内容行实际可视宽度为：

```text
left border(1) + left padding(1) + contentWidth + right padding(1) + right border(1)
```

即 `contentWidth + 4`。因此顶/底边框比内容行短 2 个终端 cell。

## Requirements

- 输入框顶边、每一行内容、底边的可视宽度必须一致。
- 普通单行 placeholder、长文本软换行、多行滚动窗口均必须保持右侧边框闭合。
- 不改变输入提交语义、slash 面板语义、颜色体系和非全屏 TUI 模式。

## Acceptance

- 新增单元测试复现并防止“右侧竖线分离”。
- `streaming-tui-ctrl-c.test.mjs` 定向测试通过。
- `npm run build` 通过。
