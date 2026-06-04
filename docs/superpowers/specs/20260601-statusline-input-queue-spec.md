# TUI 输入队列状态线规格（2026-06-01）

## 背景

轻灵 TUI 已支持串行输入队列和队列满载提示，但状态线只展示模型、会话、分支、权限、目标、任务和 token。长任务期间用户可能连续提交多条输入，此时需要在 prompt/statusline 上持续看到队列状态，而不是只依赖一次性提示。

## 目标

- 在状态线中展示本地输入队列状态。
- 队列正在处理当前输入但没有等待项时显示 `queue=run/<max>`。
- 队列有等待项时显示 `queue=<pending>/<max>`。
- 队列空闲且没有等待项时不展示 `queue` 字段，保持状态线紧凑。
- 只展示计数和本地上限，不展示用户输入正文。
- 不读取磁盘、不联网、不调用模型。

## 非目标

- 不改变输入队列的串行执行语义。
- 不持久化输入队列内容。
- 不新增 slash command 或顶层 CLI 命令。
- 不把用户输入正文写入状态线、日志或错误提示。

## 行为

- `pendingCount > 0` 时，状态线追加 `queue=<pending>/<max>`。
- `pendingCount === 0 && isProcessing === true` 时，状态线追加 `queue=run/<max>`。
- `pendingCount === 0 && isProcessing !== true` 时，不追加 queue 字段。
- `maxPending` 为有限数值时展示为 `<max>`；否则展示 `-`。

## 验收

- 单元测试覆盖格式化输出、空闲省略、运行态显示、pending 显示。
- 单元测试覆盖 `collectStatusLineSnapshot()` 从 slash context 读取输入队列元数据。
- 单元测试覆盖 `SerialInputQueue` 暴露只读上限，且不暴露输入正文。
- `npm run build`、目标单测和 `npm run ci:check` 通过。
