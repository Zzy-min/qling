# `qling hooks` / `/hooks` 本地 Hooks 可视化规格（2026-06-01）

## 背景

轻灵已有 `HookManager` 与 `ToolPipeline`，覆盖 `PreToolUse`、`PostToolUse`、`PostToolUseFailure`，并内置 permissions、rate limit、危险命令分类和内容过滤。但用户无法像 Claude Code 一样快速确认 hooks/guard 当前到底启用了什么、默认权限是什么、审计日志写到哪里。为了补齐 `/doctor`、`/context`、`/mcp` 之外的调试链路，需要一个只读 hooks 可视化入口。

## 目标

- 新增顶层命令 `qling hooks`。
- 新增中文顶层别名 `qling 钩子`。
- 新增 slash command `/hooks`。
- 新增中文 slash 别名 `/钩子`。
- 输出当前本地 hooks/guard 摘要：
  - Guard 是否启用。
  - `PreToolUse` 内置链路：permission matrix、rate limiter、speculative classifier。
  - `PostToolUse` 内容过滤状态：PII、injection、自定义模式数量。
  - `PostToolUseFailure` 是否由 pipeline 调用。
  - audit jsonl 路径。
  - 权限默认模式和规则数量。
  - redaction 状态和模式数量。
  - network url_fetch 策略摘要。
- 只显示自定义 pattern 数量，不输出 pattern 正文。
- 只读取本地配置，不运行 hooks、不读取 audit 内容、不联网、不调用模型、不写配置。

## 非目标

- 不执行 hooks 健康检查。
- 不列出任意用户脚本内容。
- 不打开或读取 audit jsonl。
- 不修改权限模式。
- 不替代 `/permissions`，只提供 hooks 视角的摘要。

## 行为

- `qling hooks` 输出本地 hooks 摘要后退出。
- `qling 钩子` 与英文顶层命令行为一致。
- `/hooks` 在当前会话输出同一类摘要，不改变会话状态。
- `/钩子` 与 `/hooks` 行为一致。
- 缺省配置下也必须输出稳定摘要，而不是报错。

## 验收

- 单测覆盖 formatter 输出 hooks 摘要、权限/rate/content/audit/redaction/network 字段。
- 单测证明自定义 content/redaction pattern 正文不会泄露。
- CLI parser/help 覆盖 `hooks` 与 `钩子`。
- Slash command 单测覆盖 `/help`、`/hooks`、`/钩子`。
- Smoke 覆盖 `node dist/index.js 钩子` 可退出，并且不泄露自定义 pattern 正文。
- `applyConfigToProcessEnv` 映射 guard rate/content 字段，保证交互内 `/hooks` 能看到配置文件加载后的值。
- `npm run build`、目标测试和 `npm run ci:check` 通过。
