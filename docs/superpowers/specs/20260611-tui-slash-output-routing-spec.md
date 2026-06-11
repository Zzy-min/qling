# TUI Slash Output Routing Spec

## 背景

MiMo-Code 强调 terminal-native slash 工作流与本地记忆命令。qling 已有 `/dream`、`/distill`、`/sessions` 等命令，但在 TUI 中 slash command 的 `writeLine` / `writeError` 仍直接写 `console.log` / `console.error`，会绕过 `StreamUI` 的追加式显示模型，造成输出和提示符状态割裂。

## 目标

- TUI 中 slash command 输出必须通过 `StreamUI` 统一追加显示。
- 普通信息输出保留多行内容，不截断、不泄露额外状态。
- 错误输出以 UI error 通道显示。
- 不改变 slash command 的解析、执行语义、历史记录策略或本地存储格式。

## 非目标

- 不重写 slash command 注册系统。
- 不引入新的外部依赖。
- 不改变非 TUI `REPL` 或 CLI 命令输出。

## 验收标准

- TUI slash 命令调用 `context.writeLine` 时不再触发 `console.log`。
- 输出内容可由测试替换的 `StreamUI` recorder 捕获。
- `context.writeError` 走 UI error 通道而不是 `console.error`。
- 定向测试、完整 CI、旧名扫描通过。
