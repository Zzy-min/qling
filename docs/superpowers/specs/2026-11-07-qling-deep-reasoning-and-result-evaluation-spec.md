# Qling Agent 深度推理架构与结果判定体系重构设计规范（Spec）

- **日期**：2026-11-07
- **目标仓库**：`D:\Projects\Active\AI\qling`（Node >= 22, TypeScript ESM）
- **参考仓库**：`D:\Projects\Archive\Reference\grok-build`（`https://github.com/xai-org/grok-build`，Rust Workspace）
- **状态**：Approved for Implementation

---

## 一、背景与重构目标

Qling 当前已具备较好的基础工程骨架（包括 `AgentLoop`、`SessionActor`、`RunEfficiencyGuard`、`StagedVerifier`、`SessionGoalController`、`MissionManager`、`ContextCompactor` 和 `DashboardServer`），但在真实复杂任务、多步骤长链路执行和结果完成判定上仍存在结构性短板：

1. **推理与执行路径单一**：无论简单问答、单步查询、多步骤开发还是高风险变更，均走同一套扁平循环（`runInnerIterationLoop`），缺少动态复杂度路由（Fast Path / Light Plan / Full Plan / High Risk）与结构化可审计决策记录（`DecisionRecord`）。
2. **计划与运行时脱节**：`src/tools/planner.ts` 仅返回静态模板文本，未生成结构化依赖图、子任务工具绑定或验收标准；`src/tools/todo.ts` 在模块加载时硬编码 `process.cwd()` 下的 `.qling-todos.json`，忽略会话 `workspaceDir`，且无依赖校验与完成门禁联动。
3. **完成判定脆弱（幻觉式提前完成）**：当模型在一轮回复中不发起 `tool_calls` 时，除已触发文件写操作且存在未通过的 `activeMutationId` 外，`runInnerIterationLoop` 直接采信模型自然语言文本并返回 `status: "succeeded"`。对于“声称已创建/修改文件但未实际落盘”、“待办/计划仍有未完成项”、“声称运行了测试但无工具证据”、“提前放弃/甩锅给用户”等场景缺乏独立的结果判定体系（`ResultEvaluator`）与收尾自检门禁（Pre-Final Self-Check Gate）。
4. **Goal 评估器与早停检测覆盖不足**：`src/session/goal-evaluator.ts` 仅输出二元 `{done, reason}`，缺少 Grok Build 的三态判定（`continue | candidate_complete | blocked` + `evidence` + `next_step` + `blocker_key`）及不可信转录防幻觉约束；`src/session/premature-stop.ts` 仅含 10 条简单正则且只挂载在 `/goal` 循环中，主循环完全未接入。
5. **长链路压缩丢失推理与计划锚点**：`ContextCompactor.compactDetailed` 保留了部分 `synthetic_reason`，但未保留结构化任务计划（`plan_state`）、决策账本（`decision_ledger`）和结果验证快照，导致长任务压缩后容易偏离原定子任务与验收标准。

本次重构深度吸收 Grok Build 开源实现中的成熟机制，在不破坏 Qling 现有 TypeScript 架构分层（`foundation -> core-services -> domain -> agent-runtime -> adapters -> presentation -> cli`）与全部既有测试的前提下，完成系统性升级。

---

## 二、阶段一：两套 Agent 系统全面源码审计与对比矩阵

### 1. Qling 真实执行路径追踪

```text
用户输入 (CLI / REPL / Daemon / SDK)
  ↓
AgentLoop.runDetailed (src/agent-loop.ts:747)
  ├─ SessionActor.enqueuePrompt (串行化会话轮次)
  └─ executeRunInternal (src/agent-loop.ts:815)
       ├─ RunCheckpointStore 恢复 / 初始化
       ├─ RecoveryController.startRun (src/execution/recovery-controller.ts:20)
       └─ runOuterAgentLoop (src/agent/main-loop.ts:1032)
            └─ runInnerIterationLoop (src/agent/main-loop.ts:218)
                 ├─ [Context] ContextCompactor.needsCompaction / compactDetailed (src/context-compactor.ts:219)
                 ├─ [Prompt] assembleSystemPrompt (src/agent/system-prompt.ts:113)
                 ├─ [Model] deps.chat(systemPrompt, activeTools, signal) (src/agent-loop.ts:1549)
                 ├─ [Branch A: 无 tool_calls] (src/agent/main-loop.ts:588-686)
                 │    ├─ 检查 activeMutationId 是否完成验证 (runWriteToolVerification)
                 │    ├─ 检查 stop_hook_active (runStopHooks)
                 │    └─ 直接返回 { status: "succeeded", text: finalText }  <-- 【缺陷：无独立 ResultEvaluator 与自检门禁】
                 └─ [Branch B: 有 tool_calls] (src/agent/main-loop.ts:688-1002)
                      ├─ prepareToolCalls (src/agent/tool-orchestrator.ts:253) — 签名去重与重复上限检测
                      ├─ executePreparedTools (src/agent/tool-orchestrator.ts:442) — 权限/沙箱/反射/语法检查
                      ├─ RunEfficiencyGuard.recordTools & recordObservationProgress (src/agent/run-efficiency.ts:419,534)
                      ├─ runWriteToolVerification (src/agent/main-loop.ts:127) -> StagedVerifier (src/execution/verification-loop.ts:259)
                      └─ 注入 synthetic_message (efficiency_recovery / verification_audit / state_snapshot) 进入下一轮
```

### 2. Grok Build 核心机制源码剖析

通过对 `D:\Projects\Archive\Reference\grok-build` 的源码审计，梳理出其 6 大核心子系统实现：

1. **Agent Loop 与 Stop Gate（`crates/codegen/xai-grok-shell/src/session/acp_session_impl/run_loop.rs`, `stop_gate.rs`, `laziness.rs`, `laziness_classifier.rs`）**：
   - Turn 结束准备返回前，统一经过 `stop_gate.rs`：顺序执行 Premature Stop 检测、Goal Orchestrator 评估与 Laziness（虚假完成 / 空口叙事）审查。
   - `laziness.rs` 与 `laziness_classifier.rs` 注入防篡改运行时真值 `[runtime_state] outstanding_background_tasks_and_subagents=N turn_elapsed_seconds=M`，并对最终回复进行 **Claim-vs-Evidence Audit**（检查模型声称执行的命令、修改的文件、通过的测试是否在历史中有对应的 `[assistant tool_call]` 与 `[tool_result]`），识别 `stalled_false_completion` 与 `stalled_narration`。
2. **推理、规划与策略重整（`goal_planner.rs`, `goal_strategist.rs`, `plan_mode.rs`）**：
   - `PlanModeTracker`（`plan_mode.rs`）：纯状态机（`Inactive | Pending | Active | ExitPending`），支持全量/稀疏交替提醒（`reminder_count.is_multiple_of(2)`）并在 Compaction 后重置为全量提醒。
   - `goal_planner.rs`：生成持久化的 `plan.md` 与不可变的 `plan.baseline.md` 基线快照。
   - `goal_strategist.rs`：当连续 `N` 次验证未达成目标（`strategist_should_fire(consecutive_not_achieved, last_fired_at, every)`）时触发策略重整，将新策略写入 `strategy.md`，同时通过 `PlanGuard`（RAII 字节级快照守卫）防止目标契约被篡改。
3. **早停与甩锅检测（`goal_stop_detector.rs`）**：
   - 提取最后一段非空文本，剥离 Markdown 装饰后用行首锚定正则面板匹配 9 类早停模式：`unable_to_proceed`、`giving_up`、`stopping_here`、`agents_in_flight`、`check_back_later`（带非用户主语二次过滤）、`verdict_line`、`commit_push_pr`、`ready_for_review`、`please_deflection`。
4. **独立结果评估与对抗式验证（`goal_evaluator.rs`, `goal_classifier.rs`, `goal_tracker.rs`）**：
   - `goal_evaluator.rs`：严格三态 JSON Schema（`decision: "continue" | "candidate_complete" | "blocked"`, `evidence`, `next_step`, `blocker_key`），限制转录窗口（32 KiB 总上限 / 4 KiB 单条上限），将助手消息标记为不可信的 `[agent_message]`，要求必须有工具输出或测试通过的客观证据才允许返回 `candidate_complete`。
   - `goal_classifier.rs`：支持多 Skeptic 面板、基于原始证据计算 `gap_fingerprint`（忽略日志路径与时间戳），当连续 2 次命中相同 `gap_fingerprint`（`GOAL_CLASSIFIER_STALL_THRESHOLD = 2`）时立即触发 `NoProgressPaused` 早停。
5. **交叉横切提醒（`crates/codegen/xai-grok-tools/src/reminders/`）與 Todo 状态管理（`todo/mod.rs`）**：
   - 工具结果尾部按需挂载 `<system-reminder>`（LSP 诊断、技能发现、后台任务完成去重提醒）。
   - `TodoWrite` 支持 `merge=true` 增量更新与 `merge=false` 全量替换，拒绝重复 ID。
6. **采样层死循环恢复（`crates/codegen/xai-grok-sampler/src/doom_loop.rs`, `doom_loop_recovery.rs`）**：
   - 捕获重复生成的异常响应，截断保留有界推理前缀（8 KiB）与文本前缀（4 KiB），注入 `<system_reminder>` 引导模型收敛输出或切换工具调用。

### 3. Qling vs. Grok Build 源码级对比矩阵

| 维度 | 当前 Qling 实现 | Grok Build 实际实现 | 核心差异 | Qling 当前缺陷 | 值得迁移的设计 | 不适合直接迁移的机制 | 预计成本 / 风险 / 收益 | 对应源文件与关键函数 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. 结构化决策循环与动态复杂度路由** | `runInnerIterationLoop` 单一扁平循环，无任务复杂度分层与结构化决策记录 | `run_loop.rs` + `PlanModeTracker` + `GoalPhase (Idle/Planning/Executing)` 按模式和复杂度分流 | Qling 对所有任务执行完全相同的循环，缺少显式决策阶段与可观测决策记录 | 简单任务可能走多余检查，复杂任务未规划直接调工具，缺少可审计的 `DecisionRecord` | 动态复杂度分析器（`fast_path` / `light_plan` / `full_plan` / `high_risk`）+ 结构化决策阶段机与 `DecisionRecord` 账本 | Grok Build 的 ACP 协议多进程 Actor 通信开销 | 成本：中<br>风险：低<br>收益：极高（兼顾简单任务零额外延迟与复杂任务规划可靠性） | Qling: `src/agent/main-loop.ts:218`, 新增 `src/agent/decision-engine.ts`<br>Grok: `xai-grok-shell/src/session/acp_session_impl/run_loop.rs` |
| **2. 任务规划与可执行计划状态机** | `src/tools/planner.ts` 仅输出静态正则模板字符串；`src/tools/todo.ts` 硬编码 `process.cwd()` 且无依赖图 | `goal_planner.rs` 写入 `plan.md` 与 `plan.baseline.md`；`todo/mod.rs` 维护带状态和优先级的 `IndexMap` | Qling 的 `planner` 与 `todo` 互不连通，且不与运行时的验证与完成门禁绑定 | 1) `todo.ts` 跨工作区路径错乱；2) 计划只是文本，无子任务依赖、预期产出、验收标准与动态重规划保留已验证步骤能力 | 可执行结构化计划模型（含依赖、工具、验收标准、恢复策略、重规划保留已验证节点）并与 `todo`/`planner`/`Mission` 同步 | Grok Build 强依赖独立 planner 子代理全量阻塞运行（简单/中等任务开销过大） | 成本：中<br>风险：低<br>收益：高 | Qling: `src/tools/planner.ts:72`, `src/tools/todo.ts:6`, `src/plan/plan-artifacts.ts`<br>Grok: `goal_planner.rs`, `todo/mod.rs` |
| **3. 独立结果判定体系（Result Evaluator）** | `src/session/outcome-evidence.ts` 仅有基础 `OutcomeContract` 匹配；主循环无独立完成验证器 | `goal_evaluator.rs` + `laziness_classifier.rs`（Claim-vs-Evidence 审计）+ `goal_classifier.rs` | Grok Build 将模型口头宣称（Untrusted Prose）与工具/文件/测试客观证据严格分离 | 模型声称“已修改文件/已通过测试/已完成”但未调用工具或工具失败时，主循环仍返回 `succeeded` | 独立 `ResultEvaluator`：支持 6 态完成分类（`completed_verified` 等）、Claim-vs-Evidence 审计、文件/命令/测试/计划完成度核验与收尾自检门禁 | Grok Build 默认拉起 3 个并行 Skeptic 子代理（单次校验消耗 3 倍 Token，应作为高风险可选策略而非默认必选） | 成本：中<br>风险：低<br>收益：极高（显著降低虚假完成率） | Qling: `src/session/outcome-evidence.ts`, `src/agent/main-loop.ts:588`<br>Grok: `goal_evaluator.rs`, `laziness_classifier.rs:125` |
| **4. 早停、甩锅与虚假完成拦截（Stop Gate）** | `src/session/premature-stop.ts` 仅含 10 条正则，且仅在 `/goal` 循环调用 | `goal_stop_detector.rs`（9 类行锚定面板 + 代词过滤）+ `stop_gate.rs` + `laziness.rs` | Qling 主循环缺少早停与未完成待办/计划拦截 | 遇到报错或耗时任务时，模型说“你可以自己运行…”或“我先停在这里”即直接结束任务 | 升级 `premature-stop.ts`（对齐 Grok 9 类分类并扩展中文语境模式），接入主循环收尾自检 Gate 与 `/goal` 控制器 | 无（纯确定性函数，零 Token 开销，完全适合迁移） | 成本：低<br>风险：极低<br>收益：高 | Qling: `src/session/premature-stop.ts`, `src/agent/main-loop.ts`<br>Grok: `goal_stop_detector.rs:88-358`, `stop_gate.rs` |
| **5. Goal 评估器与防幻觉转录构建** | `src/session/goal-evaluator.ts` 二元 `{done, reason}`，无 `evidence` / `next_step` / `blocker_key` | `goal_evaluator.rs` 三态 `{decision, evidence, next_step, blocker_key}` + 32KiB/4KiB 截断 + `[agent_message]` 不可信标签 | Qling 的 `GoalEvaluator` 无法区分“继续执行”与“外部阻塞（blocked）”，也无法按 `blocker_key` 追踪连续阻塞 | 遇到缺失外部凭证或矛盾需求时，要么无限重试耗尽预算，要么误判完成 | 扩展 `GoalEvaluation` 兼容三态决策、`evidence`、`next_step`、`blocker_key` 与 `gap_fingerprint` 停滞检测，同时向后兼容 `{done, reason}` | 无 | 成本：低<br>风险：低<br>收益：高 | Qling: `src/session/goal-evaluator.ts`, `src/session/goal-controller.ts`<br>Grok: `goal_evaluator.rs:12-235`, `goal_tracker.rs` |
| **6. 死循环识别与策略切换（Strategist & PlanGuard）** | `RunEfficiencyGuard` + `RecoveryController` + `prepareToolCalls` 签名重复上限 | `doom_loop.rs` + `goal_strategist.rs`（连续失败触发策略重整 + `PlanGuard` 保护原计划） | Qling 已有 `RunEfficiencyGuard` 的阶段转移与 12 步硬熔断，但缺少连续验证失败后的结构化策略切换笔记与计划保护 | 连续验证失败时虽有 `narrow_recovery` 提示，但缺少根因分析与替代路径生成机制 | 在 `RunEfficiencyGuard` 与恢复流中增加策略切换建议生成（Strategist Note）与计划不可变基线保护（`PlanGuard`） | 不可修改 `RunEfficiencyGuard.isToolAllowed` 默认返回 `true` 的行为（已有 SWE-bench 回归测试强依赖软重定向语义） | 成本：中<br>风险：低<br>收益：高 | Qling: `src/agent/run-efficiency.ts`, `src/execution/recovery-controller.ts`<br>Grok: `goal_strategist.rs`, `doom_loop_recovery.rs` |
| **7. 上下文工程与 Compaction 状态保留** | `ContextCompactor` 支持三层压缩、代码骨架化、防毒与历史配对修复 | `xai-chat-state` + `PlanModeTracker::reset_after_compaction` + 完整保留目标/计划引用 | Qling 在压缩时保留了 `state_snapshot` / `run_side_effects`，但未保留结构化计划、关键决策账本与验证结论 | 长对话触发 Compaction 后，模型可能遗忘已验证通过的子任务或当前决策阶段 | 将 `plan_state`、`decision_ledger`、`verification_verdict` 纳入确定性保留的 `synthetic_reason` 集合并在压缩摘要中结构化注入 | Grok Build 的服务端加密 Reasoning Item 协议 | 成本：低<br>风险：低<br>收益：高 | Qling: `src/context-compactor.ts:345`, `src/types.ts:48`<br>Grok: `plan_mode.rs:283` |
| **8. 任务状态机与可观测性（Mission / TUI / Dashboard）** | `MissionStatus` 含 8 种基础状态；`ExecutionEventBus` 发射基础工具事件 | `GoalOrchestration` 追踪细粒度阶段、验证轮次、停滞计数与实时进度面板 | Qling 缺少对“规划中 / 验证中 / 重新规划 / 等待审批 / 部分完成”及结果评估状态的细粒度映射与展示 | 用户与前端难以区分“真实验证通过的完成”与“未充分验证的完成”，也看不到当前推理阶段 | 扩展任务阶段与完成状态字典，打通 `ExecutionEventBus`、`StatusLine` 与 `Dashboard` 的阶段、进度及验证结论展示 | Grok Build 的 Ratatui 终端渲染层 | 成本：中<br>风险：低<br>收益：中 | Qling: `src/mission/types.ts`, `src/dashboard/types.ts`, `src/statusline.ts`<br>Grok: `goal_tracker.rs:29-130` |

---

## 三、分阶段架构改造设计（阶段二 ~ 阶段八）

### 阶段二：重构 Agent 推理与决策架构（`src/agent/decision-engine.ts` & `src/agent/main-loop.ts`）

1. **动态任务复杂度评估器（`assessTaskComplexity`）**：
   - 综合评估以下 7 个维度（而非仅按字数）：
     - `estimatedSteps`（操作步骤数量：单步 vs 多步）
     - `toolDependency`（工具依赖度：无工具/只读工具 vs 多写工具/跨系统工具）
     - `uncertainty`（不确定性：路径/符号已知 vs 需全局探索定位）
     - `externalMutation`（外部环境变化与副作用：只读查询 vs 文件修改/命令执行/网络请求）
     - `riskLevel`（执行风险：`low | medium | high`——涉及删除、配置变更、权限、Git 历史、批量覆写等）
     - `reversibility`（可逆性：`reversible | partially_reversible | irreversible`）
     - `successCriteriaClarity`（成功标准清晰度：`clear | implicit | ambiguous`）
   - 输出 4 档动态执行策略（`ExecutionStrategyTier`）：
     - `fast_path`（简单任务：理解 → 执行 → 验证 → 输出，跳过显式计划生成，**零额外 LLM 调用**）
     - `light_plan`（中等复杂任务：轻量拆解、按序执行、尾部确定性自检）
     - `full_plan`（复杂多步骤任务：结构化计划生成、依赖分析、分步验证、失败时动态重规划）
     - `high_risk`（高风险任务：前置权限与风险核查、环境快照保护、严格证据验证）

2. **结构化决策循环与可审计记录（`DecisionStage` & `DecisionRecord`）**：
   - 阶段枚举：`understand` → `gather` → `analyze` → `plan_decide` → `act` → `observe` → `verify` → `update_replan` → `finish`（支持按 `ExecutionStrategyTier` 动态跳过不必要环节）。
   - 每轮生成结构化、可观测的 `DecisionRecord`（绝不伪造或暴露模型原始隐藏思维链）：
     - `turn`: 轮次编号
     - `stage`: 当前决策阶段
     - `strategy`: 当前策略档位（`fast_path | light_plan | full_plan | high_risk`）
     - `goal`: 当前目标摘要
     - `knownFacts`: 已知事实列表（来自真实工具观察与文件状态）
     - `constraints`: 关键约束列表
     - `selectedAction`: 选定操作（工具调用列表或收尾响应）
     - `rationaleSummary`: 操作依据摘要（基于上下文与工具状态的可观测摘要）
     - `expectedOutcome`: 预期结果
     - `actualOutcome`: 实际执行结果摘要
     - `verificationStatus`: 验证状态（`unverified | pass | fail | partial | skipped`）
     - `nextStep`: 下一步行动（`continue | verify | replan | switch_strategy | request_user_input | finish | pause`）

3. **死循环检测与自主策略切换（Strategist Escalation）**：
   - 当连续执行相似操作无进展或连续验证失败时，触发 `analyzeStallAndSuggestStrategy`：
     1. 失败原因归因（参数错误 / 路径不存在 / 断言失败 / 环境缺失 / 重复无效探索）。
     2. 当前策略有效性检查。
     3. 搜索替代执行路径（例如从 `patch` 切换到 `read_anchored` + `patch_anchored`，从盲目 `bash` 切换到 `repo_query` / `search`，或缩小测试范围）。
     4. 更新未完成子任务计划（同时保护原始目标契约不被篡改）。
     5. 达到硬上限时安全暂停并保存恢复检查点。

### 阶段三：重构任务规划与执行控制（`src/plan/task-plan.ts`, `src/tools/planner.ts`, `src/tools/todo.ts`, `src/mission/`）

1. **可执行结构化任务计划（`StructuredTaskPlan`）**：
   - 包含：`planId`, `objective`, `strategyTier`, `createdAt`, `updatedAt`, `baselineHash`（`PlanGuard` 基线校验）, `status`（`pending | planning | running | verifying | replanning | waiting_approval | completed | partially_completed | failed | canceled`）, `steps: TaskPlanStep[]`。
   - 每个 `TaskPlanStep` 包含：
     - `id`: 步骤唯一 ID
     - `title`: 子任务描述
     - `dependsOn`: 依赖的前置步骤 ID 数组（支持 DAG 拓扑校验与环检测）
     - `order`: 执行顺序编号
     - `requiredTools`: 所需工具列表
     - `expectedOutput`: 预期产出
     - `acceptanceCriteria`: 验收标准
     - `status`: `pending | in_progress | verifying | completed | failed | skipped | blocked`
     - `recoveryStrategy`: 失败恢复策略
     - `verificationEvidence`: 已绑定的验证证据摘要
2. **动态重新规划（Dynamic Replanning）与 `PlanGuard`**：
   - `replanTaskPlan(existingPlan, update)`：当工具失败或前置条件变化时，仅修改未完成（`pending | in_progress | failed | blocked`）的步骤；**已完成且已验证（`completed` with `verificationEvidence`）的步骤强制保留**，避免重复劳动；同时通过 `baselineObjective` 守卫禁止篡改用户的核心任务目标。
3. **升级 `planner` 与 `todo` 工具并与运行时连接**：
   - `src/tools/planner.ts`：支持 `create` / `update` / `replan` / `verify_step` / `status` 操作，将结构化计划持久化到工作区状态目录（并同步到 `.qling/plans/`），同时保持对旧版只传 `{goal, context}` 调用的完全向后兼容。
   - `src/tools/todo.ts`：修复硬编码 `process.cwd()` 的 Bug，支持传入 `workspaceDir`（默认回退 `process.cwd()`），增加 `merge` 模式（参考 Grok Build `TodoWrite`）、`dependsOn`、`acceptanceCriteria`、`verificationStatus` 字段，并提供 `getWorkspaceTodoSummary(workspaceDir)` 供主循环和 `ResultEvaluator` 检查是否存在未完成待办。
4. **扩展 `Mission` 状态机**：
   - 在保持原有 8 个状态（`queued | running | blocked | paused | exhausted | succeeded | failed | canceled`）100% 兼容的基础上，在 `Mission` 模型中增加 `lifecyclePhase`（`pending | planning | running | verifying | replanning | waiting_approval | completed | partially_completed | failed | canceled`）、`completionVerdict` 与 `planSummary`，确保前后端与持久化恢复一致。

### 阶段四：构建可靠的结果判定体系（`src/session/outcome-evidence.ts`, `src/harness/evidence.ts`, `src/session/premature-stop.ts`, `src/session/goal-evaluator.ts`）

1. **六态任务完成状态分类（`TaskCompletionStatus`）**：
   - `completed_verified`：已完成且有确定性证据（测试通过、目标文件存在且非空、命令退出码为 0、所有必选交付项与计划步骤已验证）。
   - `completed_unverified`：已完成但验证不充分（例如只读问答或模型完成修改但未运行验证命令）。
   - `partially_completed`：部分完成（部分计划/待办步骤已完成，仍有未完成子任务或次要检查警告）。
   - `incomplete`：未完成（检测到早停/甩锅话术、宣称完成但无对应工具调用证据即 `false_completion`、核心交付文件缺失）。
   - `failed`：执行失败（确定性验证失败、关键工具报错未恢复、或触发错误终止）。
   - `unknown`：无法确认（环境受限或证据缺失无法判定）。

2. **独立结果评估器（`ResultEvaluator`）**：
   - 按任务类型与执行轨迹执行多维核验：
     - **文件操作核验**：检查目标文件是否存在、字节大小、内容/语法检查是否通过，拦截“口头声称已写入 `foo.ts` 但从未调用 `write`/`patch` 或文件不存在”的虚假完成。
     - **代码开发核验**：检查代码变更（`activeMutationId`）、语法检查（`checkFileSyntax`）、测试/构建验证（`StagedVerifier` / `verify` / `bash` 测试退出码）。
     - **信息检索与数据处理核验**：检查是否实际调用了检索/读取/计算工具、输出是否包含非空结果证据、是否処理了错误返回。
     - **多步骤计划与待办核验**：检查活跃的 `StructuredTaskPlan` 与 `Todo` 列表中是否仍有 `pending` / `in_progress` 的必选步骤。
     - **Claim-vs-Evidence 审计（借鉴 Grok Build `laziness_classifier.rs`）**：扫描助手最终回复中的行动宣称（如“已创建文件 X”、“已运行测试并通过”、“已修改配置”），核对本轮工具调用账本；若宣称了具体变更或测试通过却无对应成功工具记录，直接判定为 `incomplete`（`false_completion_claim`）。
     - **早停与甩锅拦截（借鉴 Grok Build `goal_stop_detector.rs`）**：通过升级版 `detectPrematureStop` 识别 `unable_to_proceed`、`giving_up`、`stopping_here`、`please_deflection`、`unbacked_verdict` 等中英文早停模式。

3. **Agent 收尾前自检门禁（Pre-Final Self-Check Gate）**：
   - 在 `src/agent/main-loop.ts` 的无 `tool_calls` 收尾分支中接入有界自检门禁（最多自检重推 1~2 次，受 `selfCheckBudget` 严格限制，避免无限自检循环）：
     1. 用户核心目标是否已覆盖？
     2. 所有计划/待办关键步骤是否已完成？
     3. 工具执行结果是否真正解决了问题（无悬空失败）？
     4. 是否存在未验证的假设或无证据的完成宣称（Claim-vs-Evidence）？
     5. 输出是否包含必要结果与验证依据？
   - 若自检判定为 `incomplete` 或 `partially_completed`（且尚有迭代预算与自检预算），向消息队列尾部注入结构化 `<verification_audit>` 自检修正指令，驱动 Agent 补齐缺失操作或验证；若超出预算，则诚实标注 `partially_completed` / `completed_unverified` 状态，绝不伪装成完美成功。

---

## 四、架构分层合规性校验（`scripts/dep-layers.mjs`）

所有新增与修改模块严格遵循 `scripts/dep-layers.mjs` 的层级约束：
- `src/execution/types.ts`、`src/types.ts`：`foundation`（rank 0）
- `src/plan/task-plan.ts`、`src/plan/plan-artifacts.ts`、`src/context-compactor.ts`：`core-services`（rank 1，仅依赖 `foundation` 与 `core-services`）
- `src/session/premature-stop.ts`、`src/session/outcome-evidence.ts`、`src/session/goal-evaluator.ts`、`src/session/goal-controller.ts`、`src/mission/types.ts`、`src/mission/manager.ts`：`domain`（rank 2，仅依赖 `domain`、`core-services`、`foundation`）
- `src/agent/decision-engine.ts`、`src/agent/main-loop.ts`、`src/agent/run-efficiency.ts`、`src/tools/planner.ts`、`src/tools/todo.ts`、`src/harness/evidence.ts`：`agent-runtime` / `other`（rank 3）
- `src/statusline.ts`、`src/dashboard-server.ts`、`src/dashboard/*`、`src/eval/*`：`adapters`（rank 4）
