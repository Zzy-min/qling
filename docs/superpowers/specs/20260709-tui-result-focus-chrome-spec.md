# TUI 结果聚焦与输入区去噪规格

## 背景

输入框上方每次恢复 prompt 都会打印 statusline 与长快捷键提示（dim/深色），视觉噪音大。任务结束后的最终答复与工具时间线混在一起，结果不够突出。

## 目标

1. **删除输入框上方黑色/深色提示文字**：`printPromptHint` / `showPrompt` / `printInputBar` 不再输出 statusline 与 `formatBottomHints()`。
2. **突出每个任务执行完后的结果**：`appendFinal` 用带标题的结果框强调最终答复；`appendDone` 完成态更醒目。
3. 不改变输入框、slash、历史、Enter/Ctrl 等交互语义。

## 行为

- 输入区只保留输入框（`›` 框），上方无固定黑灰提示行。
- `setStatusLine` / `setStatusLineEnabled` / `formatBottomHints` API 保留；`/statusline`、`/shortcuts` 仍可查看详情。
- `appendFinal(text)`：
  - 角色头 + 「结果」标记；
  - 最终答复包在结果高亮框内（不折叠长最终答复）；
  - 边框用强调色渲染（实现层着色）。
- `appendDone(durationMs)`：明确「任务完成」文案 + 耗时，视觉权重高于工具时间线。

## 非目标

- 不重做全屏 TUI / 不清屏重绘架构。
- 不改 agent 执行语义与工具输出折叠逻辑（Ctrl+O 仍作用于工具输出）。
