# 轻灵交互韧性与自适应失败恢复实施计划

**Spec**: `docs/superpowers/specs/20260712-execution-resilience-adaptive-recovery-spec.md`

## P0: Lifecycle And Stop-Loss

1. RED：状态机终态唯一性、失败分类/指纹、2/4 预算、无进展、脱敏轨迹。
2. GREEN：execution types/event bus/classifier/progress/recovery/trace store。
3. 接入 AgentLoop：run/attempt/tool/verification 事件、正式 repair 事件、暂停状态和恢复 API。
4. 接入 REPL/TUI：执行卡、R/S/E/C、`/recover`、单输入框恢复。

## P1: Verification And Durable Tasks

1. 抽出 staged verifier，确定性命令结果优先；可选模型归因复用当前 provider。
2. SessionTask 增加 failed/blocked、attempt/backoff/error；失败不再 finally 恢复 active。
3. Durable supervisor 按 session/task 隔离异常。

## P2: Trace, Dashboard And Eval

1. `/trace current|last|show|export` 与本地 retention。
2. Dashboard 详情读取 attempt timeline，不读取完整正文。
3. `eval:recovery` 重放固定 failure fixtures，输出任务级恢复指标。

## Verification

- 每阶段目标测试后运行 build。
- 最终运行 unit/integration/smoke、`ci:check`、audit、旧命名扫描和 `git diff --check`。
