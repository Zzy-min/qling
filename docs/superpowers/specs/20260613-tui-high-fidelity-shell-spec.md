# 轻灵 TUI 高拟真 Shell Spec

## 背景

当前 `StreamUI` 已有轻灵品牌 header、slash-first 提示、状态线和工具事件追加输出，但视觉结构仍偏通用 CLI。用户提供的目标图要求在现有功能基础上复刻更强的专属 TUI 外壳：顶部状态带、角色块、执行时间线、结果框和底部输入提示。

## 目标

在不改变命令语义、不新增模型调用、不改变 session/memory/token 存储格式的前提下，增强 `qling chat` / `qling tui` 的终端表现层，使其更接近目标图：

- 顶部单行状态带展示 `轻灵 Qling v<version>`、workspace、model、ready、tokens、git branch。
- 用户消息以 `You` 角色块展示。
- 助手消息以 `轻灵` 角色块展示。
- 执行态使用 `正在执行...` 与时间线行展示工具动作、目标和耗时。
- 输入区使用带边框的任务输入框和底部快捷键提示。
- 输出仍为纯终端文本，窄屏时可读降级。

## 非目标

- 不引入 alternate screen、鼠标交互、Ink/React 或新依赖。
- 不新增 slash 命令，不改变 `/help`、`/clear`、`/model`、`/exit` 等语义。
- 不改变 AgentLoop、工具调用、session/memory/token 数据结构。
- 不把报告输出系统一次性重构为全新面板。

## 公共接口

新增纯 formatter 模块 `src/tui/shell.ts`：

- `formatTopBar(snapshot)`
- `formatRoleHeader(role)`
- `formatToolTimelineRow(event)`
- `formatResultBox(lines, width)`
- `formatInputFrame(options)`
- `formatBottomHints(options?)`

这些函数只生成字符串，不直接写 stdout。`StreamUI` 负责颜色和输出。

## 行为要求

- `StreamUI.start()` 输出新版顶部状态带和输入框。
- Ctrl+L 重绘后仍输出新版顶部状态带，并保留当前输入草稿。
- 普通用户 prompt 在模型执行前显示 `You` 角色块；slash/local 命令不伪装成用户对话。
- 工具开始/完成/失败用时间线展示，长输出折叠与 Ctrl+O 行为保持。
- `appendFinal()` 输出 `轻灵` 角色块，文本清理和表格渲染保持兼容。
- `appendDone()` 输出 `分析完成` 风格完成态。
- 底部 hints 固定包含 `Enter 发送`、`Ctrl+C 中断`、`/help 帮助`、`/clear 清空对话`、`/model 切换模型`、`/exit 退出`。

## 验收

- 单测覆盖 formatter 的顶部栏、角色头、工具时间线、结果框、输入框和底部 hints。
- TUI Ctrl+L 测试确认新版 header/input frame 存在且草稿保留。
- REPL 队列测试确认普通 prompt 会渲染 `You`，slash 命令不会渲染 `You`。
- 现有 `npm run ci:check` 通过。
- 旧英文命名扫描无残留；扫描表达式在执行命令中提供，不写入仓库文档正文。
