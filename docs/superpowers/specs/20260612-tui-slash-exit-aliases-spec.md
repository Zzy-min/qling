# TUI Slash Exit Aliases Spec

## 背景

qling TUI 已支持 `exit` / `quit` / `q` 退出，但 slash-first 工作流下输入 `/exit`、`/quit`、`/q` 会进入通用 slash command 解析并显示未知指令。Claude Code 式交互应允许控制命令以 slash 形式自然生效，同时保持本地、可预测、无模型调用。

## 目标

- TUI 支持 `/exit`、`/quit`、`/q`、`/退出` 作为退出别名。
- 这些退出别名必须在 slash command registry 之前被本地处理。
- 退出别名不得写入本地 input history。
- 退出别名不得调用模型、不得触发未知 slash command 错误。

## 非目标

- 不改变非 TUI REPL 或 top-level CLI 命令语义。
- 不新增持久化格式。
- 不引入新的外部依赖。

## 验收标准

- 单元测试证明 `/exit` 会关闭 TUI，并且不调用 `processPrompt`。
- 单元测试证明 `/exit` 不写入 `input-history.json`。
- 单元测试证明 `/退出` 也会关闭 TUI。
- 完整 CI、旧名扫描、audit、diff 检查通过。
