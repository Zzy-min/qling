# Qling Agent 深度推理架构与结果判定体系重构实施计划（Plan）

- **日期**：2026-11-07
- **关联规范**：`docs/superpowers/specs/2026-11-07-qling-deep-reasoning-and-result-evaluation-spec.md`
- **实施原则**：按批推进、先写测试（TDD）、实现代码、运行验证、确保全量门禁（`npm test`、`dep:layers --strict`、`entry:check`）零回归。

---

## 第一批（高优先级）：核心推理决策引擎、独立结果判定体系与死循环恢复

### 1.1 基础类型与事件扩展（`src/types.ts`, `src/execution/types.ts`）
- 在 `src/types.ts` 的 `SyntheticReason` 中支持 `"plan_state"` 与 `"decision_ledger"`（或在现有 `state_snapshot` / `verification_audit` 中结构化承载，同时扩展 `SyntheticReason` 以保持类型安全）。
- 在 `src/execution/types.ts` 中新增：
  - `TaskCompletionStatus`: `"completed_verified" | "completed_unverified" | "partially_completed" | "incomplete" | "failed" | "unknown"`
  - `ExecutionStrategyTier`: `"fast_path" | "light_plan" | "full_plan" | "high_risk"`
  - `DecisionStage`: `"understand" | "gather" | "analyze" | "plan_decide" | "act" | "observe" | "verify" | "update_replan" | "finish"`
  - `DecisionRecord`: 包含 `turn`, `stage`, `strategy`, `goal`, `knownFacts`, `constraints`, `selectedAction`, `rationaleSummary`, `expectedOutcome`, `actualOutcome`, `verificationStatus`, `nextStep`, `timestamp`
  - 在 `ExecutionEvent` 与 `RunOutcome` 上提供可选的 `completionStatus?: TaskCompletionStatus`、`strategyTier?: ExecutionStrategyTier`、`decisionStage?: DecisionStage`、`verificationEvidence?: string[]` 字段（完全向后兼容现有字段）。

### 1.2 早停与甩锅检测器升级（`src/session/premature-stop.ts`）
- 吸收 Grok Build `goal_stop_detector.rs` 的 9 类分类体系（`unable_to_proceed`, `giving_up`, `stopping_here`, `agents_in_flight`, `check_back_later`, `verdict_line`, `commit_push_pr`, `ready_for_review`, `please_deflection`），并支持中英文双语匹配、末段提取、Markdown 剥离与 `check_back_later` 主语过滤。
- 保持原有 `detectPrematureStop(text: string): PrematureStopSignal | null` 签名与返回结构 100% 兼容，同时支持分类细分和上下文感知（如是否存在未完成任务）。

### 1.3 独立结果评估器与收尾自检（`src/session/outcome-evidence.ts`, `src/harness/evidence.ts`）
- 在 `src/session/outcome-evidence.ts`（并由 `src/harness/evidence.ts` 导出）中实现可扩展的 `ResultEvaluator`：
  - 支持 6 态完成状态（`completed_verified`, `completed_unverified`, `partially_completed`, `incomplete`, `failed`, `unknown`）。
  - 实现 **文件操作验证**（检查声称创建/修改的文件在工作区中是否真实存在、非空、格式合法）。
  - 实现 **代码开发验证**（检查变更与 `StagedVerifier`/测试命令结果、语法校验结果）。
  - 实现 **信息检索与数据处理验证**（检查工具观察证据完整性、非空输出、错误率）。
  - 实现 **多步骤计划与待办完成度验证**（核对未完成的必选计划步骤与 Todo 项）。
  - 实现 **Claim-vs-Evidence 审计**（对比模型最终回复中的具体完成宣称与真实工具执行账本，识别无工具证据支撑的 `false_completion`）。
  - 实现 **Pre-Final Self-Check Gate（`evaluatePreFinalSelfCheck`）**：输出是否放行结束（`allowFinish`）、完成状态（`completionStatus`）、缺失项列表（`unmetCriteria`）与精准修正提示（`remediationPrompt`）。

### 1.4 Goal Evaluator 三态升级与防幻觉转录（`src/session/goal-evaluator.ts`, `src/session/goal-controller.ts`）
- 升级 `src/session/goal-evaluator.ts`：
  - 支持 Grok Build 的三态决策 `decision: "continue" | "candidate_complete" | "blocked"`、`evidence`、`next_step`、`blocker_key`，并自动映射填充 `done: decision === "candidate_complete"` 与 `reason`，保证旧调用方零破坏。
  - 引入 `boundedGoalTranscript`（32 KiB 总上限 / 4 KiB 单条上限，将助手消息标记为 `[agent_message] (untrusted model self-report — not proof of completion)`）。
  - 在 `SessionGoalController.afterTurn` 中支持 `blocker_key` 连续阻塞识别与 `gap_fingerprint` 停滞检测。

### 1.5 结构化决策引擎与主循环集成（`src/agent/decision-engine.ts`, `src/agent/main-loop.ts`, `src/agent/run-efficiency.ts`）
- 新增 `src/agent/decision-engine.ts`：
  - 实现 `assessTaskComplexity(prompt, context)`：综合步骤数、工具依赖、不确定性、外部环境变化、执行风险、可逆性、成功标准清晰度 7 个维度，确定 `fast_path | light_plan | full_plan | high_risk`。
  - 实现 `DecisionLedger`：按轮次推进 `Understand -> Gather -> Analyze -> Plan/Decide -> Act -> Observe -> Verify -> Update/Replan -> Continue/Finish` 阶段，生成可审计 `DecisionRecord`，并支持格式化为紧凑的 `<decision_ledger>` 快照。
  - 实现 `analyzeLoopStallAndStrategyShift`：当连续相似操作无进展或验证失败时，执行原因归因、策略有效性检查、替代路径搜索与重规划建议生成。
- 在 `src/agent/main-loop.ts` 中接入：
  - 任务启动时执行复杂度评估并选择策略（简单任务走 `fast_path`，零额外模型调用）。
  - 每轮记录 `DecisionRecord` 并通过 `ExecutionEventBus` 发射阶段与策略事件。
  - 在无 `tool_calls` 收尾分支接入 `ResultEvaluator.evaluatePreFinalSelfCheck` 门禁（带 `maxSelfCheckNudges` 有界预算，防止死循环），拦截早停、未完成计划/待办与无证据虚假完成宣称。

---

## 第二批（核心能力增强）：结构化计划、动态重规划、状态机与上下文保持

### 2.1 结构化任务计划与动态重规划（`src/plan/task-plan.ts`, `src/plan/plan-artifacts.ts`）
- 新增 `src/plan/task-plan.ts`（位于 `core-services` 层）：
  - 定义 `StructuredTaskPlan` 与 `TaskPlanStep`（含任务目标、子任务、依赖 `dependsOn`、执行顺序 `order`、所需工具 `requiredTools`、预期产出 `expectedOutput`、验收标准 `acceptanceCriteria`、当前状态 `status`、失败恢复策略 `recoveryStrategy`、验证证据 `verificationEvidence`）。
  - 实现拓扑排序与循环依赖检测 `validatePlanDependencies`。
  - 实现动态重规划 `replanStructuredTaskPlan`：保留所有 `completed` 且有验证证据的步骤，仅重排/更新未完成或失败步骤，并通过 `PlanGuard` 校验核心 `objective` 未被篡改。
  - 实现工作区级计划持久化与加载（`.qling/plans/active-plan.json` 及 `.qling/plans/plan.md`）。

### 2.2 升级 `planner` 与 `todo` 工具（`src/tools/planner.ts`, `src/tools/todo.ts`）
- 升级 `src/tools/planner.ts`：
  - 支持结构化操作（`action: "create" | "update_step" | "replan" | "get" | "verify"`）及子任务列表输入，将计划持久化至工作区 `.qling/plans/active-plan.json` 并返回结构化计划与下一步可执行子任务（无未完成前置依赖的 `readySteps`）；同时保留仅传 `{goal, context}` 时的兼容输出。
- 升级 `src/tools/todo.ts`：
  - 修复硬编码 `process.cwd()` 的缺陷，支持按 `workspaceDir` 解析 `.qling-todos.json`。
  - 支持 Grok Build 风格的 `merge` 增量更新模式、重复 ID 检查、前置依赖 `dependsOn`、验收标准 `acceptanceCriteria` 与完成度统计 `getTodoCompletionSummary(workspaceDir)`。

### 2.3 扩展任务状态机（`src/mission/types.ts`, `src/mission/manager.ts`）
- 在 `src/mission/types.ts` 中新增 `MissionLifecyclePhase`:
  `"pending" | "planning" | "running" | "verifying" | "replanning" | "waiting_approval" | "completed" | "partially_completed" | "failed" | "canceled"`。
- 在 `MissionManager` 中支持 `updateLifecyclePhase`、`updateCompletionVerdict` 与 `updatePlanSummary`，自动同步映射底层 `MissionStatus`，保证持久化和跨进程恢复一致性。

### 2.4 长任务上下文保持增强（`src/context-compactor.ts`）
- 在 `ContextCompactor.compactDetailed` 中确保 `plan_state`、`decision_ledger`、`verification_audit` 等关键推理与计划锚点在压缩后被确定性保留。
- 在 `validateCompactionCandidate` 中校验活跃计划与最新用户约束未丢失。

---

## 第三批（体系完善）：前后端可观测性同步与 12 场景量化评估体系

### 3.1 状态栏与 Dashboard 可观测性同步（`src/statusline.ts`, `src/dashboard/types.ts`, `src/dashboard/model.ts`, `src/dashboard-server.ts`）
- 在 `StatusLineSnapshot` 与 `DashboardAgentLive` / `DashboardTask` 中暴露当前推理阶段（`decisionStage`）、执行策略（`strategyTier`）、计划进度（`planProgress`）与验证判定状态（`completionStatus`）。

### 3.2 12 场景离线契约验收（`src/eval/reasoning-benchmark.ts`, `scripts/eval-reasoning-verdict.mjs`）
- 本地夹具覆盖以下 12 类场景。S10 使用脚本化模型驱动生产执行循环，其余场景检验组件行为。
  1. 简单单步任务（测试 `fast_path` 零冗余调用）
  2. 多步骤文件处理任务
  3. 代码修改与验证任务
  4. 工具失败恢复任务
  5. 参数错误修正任务
  6. 重复失败死循环打断任务
  7. 信息不足需要二次检索任务
  8. 计划中途变更（动态重规划保留已验证步骤）任务
  9. 长上下文多轮任务（Compaction 后保留目标/计划/决策锚点）
  10. 表面成功但实际未完成任务（拦截口头宣称创建的 `false_completion`）
  11. 部分完成需诚实汇报任务（识别 `partially_completed`）
  12. 高风险操作需谨慎处理任务（`high_risk` 策略与严格核验）
- CLI 输出 JSON，逐项记录验收结果、真实夹具工具调用和本地耗时。CLI 在任一场景未通过时返回非零退出码。
- 历史基线尚未执行，报告将 baseline、baselineMetrics 和 deltas 设为 null 并给出原因。真实模型任务成功率与延迟同样留空。
