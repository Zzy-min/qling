# Grok Build TUI 同功能对比与改进复查

日期：2026-07-31
上游基线：`xai-org/grok-build@dd04f397b1d02f2272b092555669dfba1f01bc85`

## 对比结论

| 能力 | Grok Build | 轻灵改进后 |
| --- | --- | --- |
| 鼠标拖选 | 应用内处理 Down / Drag / Up，松开后复制 | SGR 1006 + button-motion 1002，逻辑选区跨行、松开自动复制 |
| 选区与快捷键 | 鼠标捕获常开，键盘动作独立分发 | 不再切换 QuickEdit；Shift+Tab、Ctrl+C、Enter、Slash 命令保持可用 |
| 滚轮 | 归一化后按帧合并，避免高频整屏刷新 | 16ms 合并、每刻度 3 行、只刷新变化的内容行 |
| 长内容 | 选区绑定逻辑内容，滚动后仍可重建 | 屏幕行映射到逻辑正文；支持中文宽字符、空白行和长行截断高亮 |
| 剪贴板 | 选区完成后统一复制并反馈状态 | `/copy`、拖选和粘贴共用跨平台剪贴板适配，显示成功或失败反馈 |
| 终端生命周期 | 进入/退出时对称恢复鼠标、光标和备用屏幕 | 对称启停 1000/1002/1006、光标和 alternate screen；异常退出复用恢复路径 |

## 清理的冲突实现

- 删除未接入且会关闭应用鼠标输入的 Windows QuickEdit 实验代码。
- 删除 `claude-style` 中重复的 Windows-only 剪贴板写入，统一到 `runtime/clipboard`。
- Alt+C 改为重新复制当前持久选区，不再改变输入模式或鼠标捕获状态。

## 新增防回归覆盖

- SGR 鼠标报告与普通按键混输。
- 鼠标报告跨 stdin chunk 分片，不泄漏为输入字符。
- 中文宽字符跨行选区、逻辑空白保留、长行截断后的选区高亮。
- 自动复制、Alt+C 重复制、复制反馈。
- 拖选期间 Shift+Tab、Ctrl+C、Enter 和底部 Slash 功能键持续可用。
- 小步滚轮、到达最顶端、固定顶栏和输入框不参与滚动重绘。

## 验证记录

- Dashboard 组件测试：1/1 通过。
- TypeScript + Dashboard 构建：通过。
- 单元测试：1070/1070 通过。
- Smoke：并发运行 73 通过、2 跳过，`repl-shutdown` 仅发生一次 8 秒容量超时；单文件串行复验 1/1 通过（2.15 秒）。
- `eval:smoke`：22/22 通过。
- `eval:tasks`：10/10 通过。
- anchored edit：20 fixtures，通过率与安全约束达标。
- packaging：通过。
- dependency layers strict：0 条禁止反向依赖。
- `git diff --check`：通过（仅 Git 的 CRLF 转换提示）。

## 剩余人工验收

自动化已覆盖字符网格、转义序列和状态转换。发布前仍建议在目标 Windows Terminal 中手工拖选一次中文、多行代码和滚动后的历史内容，以核对终端宿主的字体、鼠标报告和系统剪贴板体验。
