# 执行韧性剩余项完成计划

**基线计划**: `docs/superpowers/plans/20260712-execution-resilience-adaptive-recovery-plan.md`

**缺口审计**: `docs/superpowers/reviews/20260714-execution-resilience-gap-audit.md`

## Phase 1: Deterministic Recovery

1. RED：覆盖每类失败的首选策略、next 策略、无可用策略暂停和 context 单次压缩。
2. GREEN：新增 `RecoveryStrategyPlanner`，扩展 `RecoveryState` 的当前/已尝试策略。
3. 让 `retry` 重用当前策略，`next` 消耗下一条不同策略，`edit/cancel` 正确结束暂停态。

## Phase 2: AgentLoop And TUI

1. RED：验证 AgentLoop 按策略生成定向恢复指令，不再使用无差别重试提示。
2. 接入 context compaction、参数 schema 反馈、tool-not-found 证据检查和定向验证策略。
3. REPL 订阅 execution events，只在阶段变化时输出简洁状态行；暂停卡片仍是唯一动作面。

## Phase 3: Eval And Gates

1. 扩充 `eval:recovery` 固定夹具，覆盖 invalid args、repeated action、approval、sandbox、429、context、验证不变和验证改善。
2. 支持从脱敏 JSONL 事件重放指标，不读取 prompt 或工具正文。
3. 运行 build、目标 unit、`eval:recovery`、`ci:check`、audit、旧命名扫描和 `git diff --check`。

## Compatibility

- 不改变 slash command 签名、session/memory 格式或非全屏 TUI。
- 新增状态字段均为可选或在内部构造，旧 trace 和旧 SessionTask 保持可读。
- 不自动扩大权限，不在 sandbox/审批失败后偷偷执行替代命令。
