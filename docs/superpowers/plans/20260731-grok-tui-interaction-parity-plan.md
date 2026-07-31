# Grok Build TUI 交互同功能改进计划

1. 为统一 SGR mouse 解析、拖选复制和 Alt+C 语义补失败测试。
2. 实现逻辑正文行选区、ANSI/CJK 单元格切片与持久高亮。
3. 将 Down/Drag/Up 与滚轮共同路由到全屏渲染器，启用 `1002` drag 报告。
4. 抽取本机剪贴板写入端口，供 TUI 与 `/copy` 共同复用。
5. 验证底部功能键、Shift+Tab、滚动、斜杠输入和长任务固定 chrome 无回归。
6. 串行执行定向测试、构建、完整门禁及 Windows Terminal 真实验收，并记录并发 smoke 与串行复验的差异。
