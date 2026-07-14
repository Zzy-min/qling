# 执行韧性计划缺口审计

**审计基线**: `2f1b678`，对应 `20260712-execution-resilience-adaptive-recovery-plan.md`。

## 已完整落地

- Execution run/attempt/tool 事件和唯一终态去重。
- 失败分类、稳定指纹、同因 2 次和总策略 4 次预算。
- Provider 瞬时错误独立退避，不占策略预算。
- 脱敏 JSONL trace、30 天/50 MiB retention、最近事件有界读取。
- `/recover`、`/trace`、暂停动作栏、SessionTask 失败退避和 supervisor 隔离。
- Dashboard attempt timeline 和基础恢复指标。

## 部分落地

### P0 恢复动作

- `RecoveryController` 只返回 `recover/pause`，没有按失败类别选择稳定策略。
- `/recover retry` 与 `/recover next` 只改变提示词，未记录当前策略、下一策略和已尝试策略。
- `edit` 被标记为 `recovering`，与“恢复草稿并结束当前执行卡片”的语义不一致。
- 无活动暂停任务时调用恢复动作会抛错，缺少可判定的动作前置条件。

### P0 交互可见性

- TUI 只在暂停时展示恢复卡片；运行、工具、验证和恢复阶段没有统一状态摘要。
- execution events 已生成，但 REPL 未订阅它们，阶段、尝试次数和剩余预算无法实时呈现。

### P1 验证闭环

- `StagedVerifier` 支持阶段数组，但 AgentLoop 只传入单个 `configured` 命令。
- 旧 `VerificationAgent` 仍独立存在，形成规则验证、模型验证和 staged verifier 三条路径。
- 验证失败只比较 diff hash 与失败集合，未记录已选恢复策略和修改文件摘要。

### P2 评测

- `eval:recovery` 仅验证五类分类和一个停滞场景，未覆盖策略切换、预算、逐步改善、审批/sandbox 停止、context 单次压缩和 trajectory 重放。
- 指标缺少用户介入前耗时和每成功任务 provider token；当前事件类型也未携带对应摘要字段。

## 本轮收尾边界

1. 新增纯确定性 `RecoveryStrategyPlanner`，为每类失败给出可执行或暂停策略。
2. 让 controller 持有当前策略、已尝试策略和恢复动作，保证 retry/next/edit/cancel 状态一致。
3. AgentLoop 使用策略决策，不再用通用提示词无限重跑；context 压缩最多一次，权限/sandbox/repeated action 直接暂停。
4. REPL 订阅 execution events，用单行、低噪声状态展示运行阶段，不重绘输入框。
5. 扩充 deterministic recovery eval 并支持摘要 trajectory replay。
6. 不在本轮移除全部旧验证器；先消除写操作失败恢复中的双路径，后续再单独重构通用 verification API。
