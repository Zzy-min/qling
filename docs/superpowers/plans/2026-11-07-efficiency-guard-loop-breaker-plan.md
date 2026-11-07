# 效率守卫与死循环熔断实施计划 (Efficiency Guard & Loop Breaker Plan)

- **日期**: 2026-11-07
- **关联设计规范**: `docs/superpowers/specs/2026-11-07-efficiency-guard-loop-breaker-design.md`
- **目标**: 实现效率守卫硬熔断、阶梯告警持续在线、合成消息活跃尾部插入、命令输出重定向语义归一化防循环，并通过全新自动化测试验证。

---

## 阶段清单

### 阶段 1: 核心机制实现
- [ ] **1.1 `src/agent/run-efficiency.ts`**:
  - 在 `EfficiencySignal` 中扩展 `disposition: "redirect" | "pause"` 与 `code: ... | "NO_PROGRESS_HALT"`。
  - 在 `RunEfficiencyOptions` 中添加 `noProgressHaltLimit`（默认 12）。
  - 在 `RunEfficiencyGuard` 构造函数中初始化 `noProgressHaltLimit = Math.max(this.noProgressNarrowLimit + 1, options.noProgressHaltLimit ?? 12)`。
  - 在 `recordProgress` 中：
    - `noProgressActions >= noProgressHaltLimit` 触发硬熔断，返回 `disposition: "pause"`。
    - `noProgressActions >= noProgressNarrowLimit` 且步数为偶数或等于 narrowLimit 时，持续发出阶梯定向警告，包含即将熔断的步数预警。
    - 维持 4 步时的 `replan_repository`。
- [ ] **1.2 `src/agent/main-loop.ts`**:
  - 在接收到 `efficiencyStop?.disposition === "pause"` 时：
    - 触发 `host.recoveryController.pauseActiveRun()`。
    - 完成 attempt `host.executionEventBus.completeAttempt(runId, "recovering")`。
    - 触发 `host.emit("efficiency_guard", efficiencyStop)`。
    - 返回 `{ status: "paused", text: efficiencyStop.reason }`。
- [ ] **1.3 `src/agent/synthetic-messages.ts`**:
  - 定义 `EPISODIC_SYNTHETIC_REASONS`（包含 `efficiency_recovery` 等）。
  - 在 `upsertSyntheticMessage` 中，对于情景消息，如果已存在则将其移出原位，统一添加到 `messages` 数组末尾，确保 LLM 活跃注意力窗口直接感知。
- [ ] **1.4 `src/agent/tool-orchestrator.ts`**:
  - 增强 `buildToolSignature`：对于 `bash` 命令中的临时文件重定向模式（如 `>\s*(?:%TEMP%|\$TEMP|/tmp|g\d+\.txt|[a-zA-Z0-9_\-.]+\.tmp)\b` 等），进行规范化替换，防止模型通过自增输出文件名绕过 `toolRepeatLimit`。

---

### 阶段 2: 单元测试与验证
- [ ] **2.1 创建专门测试文件**: `tests/unit/efficiency-guard-loop-breaker.test.mjs`
  - 测试 1: 连续无进展在 4 步触发 replan，8 步触发 narrow，10 步触发升级告警，12 步触发 pause 硬熔断。
  - 测试 2: 产生有效因果证据重置计数器后，熔断阈值被重置。
  - 测试 3: `upsertSyntheticMessage` 对于 `efficiency_recovery` 消息始终保持在尾部，即使先前已被插入过。
  - 测试 4: `prepareToolCalls` 能通过重定向归一化检测到如 `grep ... > g3.txt`, `> g4.txt`, `> g5.txt` 达到重复上限并触发 `TOOL_REPEAT_LIMIT_EXCEEDED`。
- [ ] **2.2 回归验证**:
  - 运行 `npm run build`
  - 运行 `node --test tests/unit/efficiency-guard-loop-breaker.test.mjs tests/unit/run-efficiency.test.mjs tests/unit/recovery-episode.test.mjs`
  - 运行所有单元测试，确保无任何回归破损。

---

### 阶段 3: 评审与提交
- [ ] **3.1 编写审查文档**: `docs/superpowers/reviews/2026-11-07-efficiency-guard-loop-breaker-review.md`
- [ ] **3.2 Git 提交与推送**:
  - 提交代码到分支 `codex/first-run-auth` 并推送到远程仓库。
