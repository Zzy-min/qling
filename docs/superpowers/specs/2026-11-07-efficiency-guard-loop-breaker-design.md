# 效率守卫与死循环熔断优化设计规范 (Efficiency Guard & Loop Breaker Design)

- **状态**: 草案 / 设计中
- **日期**: 2026-11-07
- **作者**: Antigravity Pair Programmer
- **影响范围**: `src/agent/run-efficiency.ts`, `src/agent/synthetic-messages.ts`, `src/agent/tool-orchestrator.ts`, `src/agent/main-loop.ts`, `src/types.ts`

---

## 1. 背景与问题定义

### 1.1 问题场景
在会话 `session-1794031395109`（run `run_mw606lc3_ig050`）中，模型在执行分析任务时，进入死循环：
- 模型从约第 110 轮开始，反复执行 `grep -a -n -e "OpenCLI" %TEMP%\r1.txt > %TEMP%\g*.txt`，每次仅将输出重定向文件名由 `g3.txt` 递增到 `g4.txt`、... `g379.txt`。
- 因为输出文件名每次改变，原有基于参数字面量的 `toolRepeatLimit` 未判定为完全重复。
- 因为 `cmd.exe` 重定向命令返回 exit code 0，未被归入工具执行失败 (`failed: true`)，而是进入 `recordObservationProgress`。
- 因为没有产生新的因果证据（非测试、非环境变化、且文件为空），被判定为 `kind: "no_progress"`。
- 然而，效率守卫在 `noProgressActions` 达到 4（`noProgressReplanLimit`）和 8（`noProgressNarrowLimit`）后，对于后续动作（`noProgressActions >= 9`）由于严格使用 `===` 判定，**直接全部返回 `null`，陷入彻底失声**。
- 此外，早期插入的 `<efficiency_recovery>` 提示词被 `upsertSyntheticMessage` 放置在第 1 条真实用户消息之前（索引 0~2）。在长达数百轮、数千万 token 的历史长文中，模型完全无法在尾部活跃注意力窗口中看到该提示。
- 最终导致 Agent 空转 370+ 轮，白白消耗 3400+ 万 tokens，直到被用户手动取消。

### 1.2 目标与非目标

#### 目标
1. **硬熔断机制 (Hard Circuit Breaker)**: 当连续无进展动作达到硬熔断阈值（默认 12 步）时，自动触发 `disposition: "pause"`，阻断后续工具执行并将 Agent 运行状态置为 `paused`，彻底杜绝无休止空转。
2. **阶梯告警持续在线 (Escalating Warnings)**: 告警不再在到达 8 步后沉寂。在 4 步（规划收敛）、8 步（工具窄化）、10 步（熔断预警）及后续步骤中持续输出定向引导。
3. **活跃上下文即时可见性 (Active-Context Visibility)**: 区分静态序言类提示词与情景恢复类提示词（如 `efficiency_recovery`）。情景恢复提示词在更新时必须置于活跃上下文尾部，确保当前注意力窗口绝对可见。
4. **命令语义归一化防循环 (Command Semantic Normalization)**: 在工具签名与循环检测中，对 bash/cmd 临时重定向文件（如 `> %TEMP%\g*.txt`、`> /tmp/...`）进行规范化脱敏，使 `g3.txt`、`g4.txt` 等递增假象被识别为同一命令签名，触发重复检测。
5. **完整可测性与验证**: 编写覆盖上述场景的单元测试，保证所有历史用例与新用例 100% 通过。

#### 非目标
- 不改变正常通过因果证据推进状态机的核心语义。
- 不阻断用户主动发起的 `/recover` 或交互续跑。

---

## 2. 核心架构与详细设计

### 2.1 效率守卫阶梯与硬熔断 (`run-efficiency.ts`)

#### 2.1.1 阈值体系
在 `RunEfficiencyOptions` 中增加 `noProgressHaltLimit`（默认 12，需大于 `noProgressNarrowLimit`）：
```ts
export interface RunEfficiencyOptions {
  sameFailureLimit?: number;       // 默认 2
  totalFailureLimit?: number;      // 默认 8
  noProgressReplanLimit?: number;  // 默认 4
  noProgressNarrowLimit?: number;  // 默认 8
  noProgressHaltLimit?: number;    // 默认 12（新增）
  ...
}
```

#### 2.1.2 信号定义扩展
`EfficiencySignal` 的 `disposition` 联合类型从单一的 `"redirect"` 扩展为 `"redirect" | "pause"`：
```ts
export interface EfficiencySignal {
  code: "SAME_FAILURE_LIMIT" | "TOTAL_FAILURE_LIMIT" | "PROGRESS_PHASE" | "NO_PROGRESS_HALT";
  disposition: "redirect" | "pause";
  reason: string;
  phase?: ProgressPhase;
  tool?: string;
  fingerprint?: string;
  directive: RecoveryDirective;
}
```

#### 2.1.3 动作累积阶梯处理
在 `recordProgress` 中：
```ts
this.noProgressActions++;

// 1. 硬熔断检查（>= haltLimit）
if (this.noProgressActions >= this.noProgressHaltLimit) {
  return {
    code: "NO_PROGRESS_HALT",
    disposition: "pause",
    reason: `连续 ${this.noProgressActions} 个动作没有产生新证据，触发效率守卫硬熔断；任务自动暂停以避免无休止消耗。请检查策略或补充上下文后继续。`,
    fingerprint: signal.fingerprint,
    phase: this.phase,
    directive: {
      action: "checkpoint",
      reason: "no_progress_halt",
    },
  };
}

// 2. 阶梯警告（>= narrowLimit，每 2 步提醒一次）
if (this.noProgressActions >= this.noProgressNarrowLimit) {
  if (this.noProgressActions === this.noProgressNarrowLimit || this.noProgressActions % 2 === 0) {
    const allowedTools = this.activeMutationId
      ? ["repo_query", "impact_analysis", "read", "patch", "write", "bash"]
      : ["repo_map", "repo_query", "impact_analysis", "read", "search", "bash"];
    this.recoveryAllowedTools = new Set(allowedTools);
    this.phase = this.activeMutationId ? "repair" : "diagnose";
    return {
      code: "TOTAL_FAILURE_LIMIT",
      disposition: "redirect",
      reason: `连续 ${this.noProgressActions} 个动作没有产生新证据（将在第 ${this.noProgressHaltLimit} 步硬熔断暂停）；请立即收敛并切换恢复策略。`,
      fingerprint: signal.fingerprint,
      phase: this.phase,
      directive: {
        action: "narrow_recovery",
        allowedTools,
      },
    };
  }
}

// 3. 规划收敛（=== replanLimit）
if (this.noProgressActions === this.noProgressReplanLimit) {
  return {
    code: "TOTAL_FAILURE_LIMIT",
    disposition: "redirect",
    reason: `连续 ${this.noProgressActions} 个动作没有产生新证据；停止随机浏览，基于仓库索引、错误根因和验证差异重新规划。`,
    fingerprint: signal.fingerprint,
    phase: this.phase,
    directive: {
      action: "replan_repository",
      rootCauseId: this.activeRootCauseId ?? undefined,
      preserveEvidence: [...this.evidenceFingerprints].slice(-20),
    },
  };
}
```

### 2.2 主循环硬熔断响应 (`main-loop.ts`)
在 `main-loop.ts` 中检查 `efficiencyStop?.disposition === "pause"`：
```ts
if (efficiencyStop?.disposition === "pause") {
  host.recoveryController.pauseActiveRun();
  host.executionEventBus.completeAttempt(runId, "recovering");
  host.emit("efficiency_guard", efficiencyStop);
  return {
    status: "paused",
    text: efficiencyStop.reason,
  };
}
```
当触发硬熔断时，主循环不再继续调用 LLM，而是优雅将 run 状态保存并切换为 `paused`，通知用户。

### 2.3 活跃上下文消息位置优化 (`synthetic-messages.ts`)
定义情景式合成消息分类：
```ts
const EPISODIC_SYNTHETIC_REASONS = new Set<SyntheticReason>([
  "efficiency_recovery",
  "recovery_instruction",
  "history_repair",
  "interrupted_run",
]);
```
在 `upsertSyntheticMessage` 中：
- 如果 `reason` 属于 `EPISODIC_SYNTHETIC_REASONS`：
  - 如果已有同 reason 的消息，将其从原位置删除；
  - 将新消息放入消息数组的尾部（或者紧跟在最新工具执行结果之后）；
  - 从而确保 LLM 下一次补全时，提示词位于上下文尾部，具有极高注意力权重。
- 其余前缀静态类消息（`runtime_environment`, `dynamic_context` 等）仍保持在 `firstRealUser` 之前。

### 2.4 命令签名归一化与重复检测 (`tool-orchestrator.ts`)
在 `buildToolSignature` 及命令指纹中，针对 bash 工具参数做语义去噪：
- 识别并剥离临时重定向（例如 `>\s*.*?[\w-]+\.\w+` 中形如 `%TEMP%\...`, `/tmp/...`, `g\d+\.txt` 等）；
- 消除命令中的多余空白符与临时数字后缀；
- 使得 `grep -a -n -e "OpenCLI" r1.txt > g3.txt` 和 `grep -a -n -e "OpenCLI" r1.txt > g4.txt` 计算出相同的工具签名 `bash:grep -a -n -e "OpenCLI" r1.txt > <temp-redirect>`；
- 当连续执行超过 `toolRepeatLimit`（默认 6 次）时，直接返回 `TOOL_REPEAT_LIMIT_EXCEEDED` 错误，阻止模型继续发散。

---

## 3. 兼容性与风险评估
- **向下兼容**: 对正常的任务流程无负面影响；所有历史测试案例（4 步 replan、8 步 narrow）依然正常通过。
- **防止误伤**: 12 步无因果证据才进入熔断，对于有证据产生（读写交付物、产生测试 diff、改变环境等）的动作，`this.noProgressActions` 会被重置为 0。
- **可恢复性**: 熔断状态返回 `status: "paused"`，用户可通过输入补充指示或 `/recover` 随时无损恢复。
