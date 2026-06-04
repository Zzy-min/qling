# `qingling` 顶层 Doctor 命令规格（2026-05-31）

## 背景

`/doctor` 已能在 TUI 内做本地诊断，但稳定性排查经常发生在“不想进入交互 UI”的场景。为了贴近 Claude Code CLI 的可诊断体验，需要提供顶层 `qingling doctor`。

## 目标

- 新增顶层命令：`qingling doctor`。
- 命令在加载配置并应用 runtime env 后执行，不实例化完整 `AgentLoop`，避免因 LLM API key 或工具初始化影响本地诊断。
- 输出与 `/doctor` 同源的本地诊断报告。
- 保持所有诊断只读本地状态和本机 loopback，不访问公网。

## 验收

- parser 单测覆盖 `parseCliArgs(["doctor"]) -> mode=doctor`。
- help 文案包含 `qingling doctor`。
- smoke 测试覆盖 `node dist/index.js doctor` 退出码为 0 且输出 Doctor 报告。
- `npm run ci:check` 通过。
