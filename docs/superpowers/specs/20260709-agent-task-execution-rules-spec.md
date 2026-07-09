# 轻灵任务执行基本规则规格

## 目标

将用户指定的三条任务执行规则固化进 Agent 常驻 system prompt（Workflow / Restrictions / Tone），使每次会话默认遵守：

1. **调用外部工具前**：先深入分析工具能力与任务要求的关联，再调用。
2. **成功后**：总结正确可复现流程（步骤、命令、结果要点）。
3. **单流程失败或未准确执行时**：实事求是承认失败/偏差，不编造成功、不隐瞒错误原因。

## 行为

- 写入 `buildWorkflowSection` 与 `buildRestrictionsSection`（必要时 Tone 中强调诚实）。
- 更新 `skills/qling.md` 摘要，便于 skill 加载时一致。
- 单测断言关键字存在。

## 非目标

- 不改工具实现语义；不引入自动评测框架。
