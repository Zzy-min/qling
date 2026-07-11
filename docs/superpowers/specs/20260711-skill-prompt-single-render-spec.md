# 轻灵 Skill 调用后输入框单次渲染 Spec

## Problem

slash/skill 命令由 `SerialInputQueue` 串行执行。命令处理完成时，队列内部处理函数与队列外层提交函数都可能调用 `StreamUI.showPrompt()`，导致同一次 `/skill` 或其他本地 slash 命令结束后连续绘制两个输入框。

## Required Behavior

- 每次用户输入完成后只允许队列所有任务排空的外层生命周期恢复一次输入框。
- `/skill`、`/skill list`、直接 `/<skill-name>` 与其他本地 slash 命令遵循同一规则。
- 命令输出、状态线刷新、立即 prompt、排队输入和退出语义保持不变。
- 输入队列仍只在最后一项处理完成后恢复输入框，处理中不得提前显示可编辑输入框。

## Boundary

- 本轮只修复 REPL 输入框恢复所有权，不改变 skill 文件读取、slash catalog、TUI 边框和输入缓冲格式。
- Dashboard 工作台改动保持独立，不在本修复中调整。

## Acceptance

- `/skill list` 执行完成后 `showPrompt()` 恰好调用一次。
- 命令处理函数本身不直接恢复输入框，恢复动作只发生在输入队列排空以后。
- 连续排队输入仍只在最终 drain 后恢复一次输入框。
