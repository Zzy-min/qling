# 效率守卫与死循环熔断评审记录 (Efficiency Guard & Loop Breaker Review)

- **日期**: 2026-11-07
- **关联设计**: `docs/superpowers/specs/2026-11-07-efficiency-guard-loop-breaker-design.md`
- **关联计划**: `docs/superpowers/plans/2026-11-07-efficiency-guard-loop-breaker-plan.md`
- **评审结论**: 通过 (PASS)

---

## 1. 变更清单与影响

| 文件 | 变更说明 |
| :--- | :--- |
| `src/agent/run-efficiency.ts` | 1. 扩展 `EfficiencySignal.disposition` 联合类型为 `"redirect" \| "pause"`，增加 `"NO_PROGRESS_HALT"` 错误码。<br>2. 新增 `noProgressHaltLimit`（默认 12 步）。<br>3. 在 `recordProgress` 中增加阶梯预警（偶数步提醒即将在第 12 步硬熔断），在达到 12 步时触发 `disposition: "pause"` 硬熔断。 |
| `src/agent/main-loop.ts` | 接收到 `efficiencyStop.disposition === "pause"` 时触发 `pauseActiveRun()`，广播事件，并直接返回 `{ status: "paused", text: efficiencyStop.reason }`，彻底阻断空转。 |
| `src/agent/synthetic-messages.ts` | 区分情景恢复消息（`EPISODIC_SYNTHETIC_REASONS`）与前缀序言消息。对于 `efficiency_recovery`，始终将其更新放置于 `messages` 数组末尾，确保活跃注意力窗口直接可见。 |
| `src/agent/tool-orchestrator.ts` | 增加 `normalizeCommandForSignature`：归一化剥离临时输出文件（如 `> %TEMP%\g*.txt`、`> /tmp/...` 等），使自增临时文件的重复命令能被 `prepareToolCalls` 准确识别并触发 `TOOL_REPEAT_LIMIT_EXCEEDED`。 |
| `tests/unit/efficiency-guard-loop-breaker.test.mjs` | 全新单元测试：覆盖 4 步规划、8 步窄化、10 步阶梯预警、12 步硬熔断暂停、因果证据重置计数、情景消息尾部可见性、命令重定向归一化防循环检测。 |

---

## 2. 验证证据

- **构建编译**:
  `npm run build` -> Exit code 0
  - `clean-dist` 成功
  - `tsc` 成功，类型检查全部通过
  - `dashboard:build` (Vite) 成功
- **回归与专项测试**:
  `node --test tests/unit/efficiency-guard-loop-breaker.test.mjs tests/unit/run-efficiency.test.mjs tests/unit/synthetic-messages.test.mjs tests/unit/recovery-episode.test.mjs tests/unit/tool-orchestrator.test.mjs`
  - 运行用例总数: 63
  - 通过用例: 63
  - 失败用例: 0
  - 持续时间: ~12.4s

---

## 3. 问题关闭核对

- [x] 解决了效率守卫超过 8 步后完全失声（`return null`）的问题：引入 10 步告警与 12 步硬熔断暂停机制。
- [x] 解决了 `<efficiency_recovery>` 提示词被插入到第 1 轮前导致模型不可见的问题：情景消息动态移至上下文尾部。
- [x] 解决了模型通过自增输出重定向文件名（`g3.txt` -> `g4.txt`）绕过工具重复限制的问题：命令语义归一化。
- [x] 严格遵循工作流规约：Spec -> Plan -> Implementation -> Fresh Verification -> Review。
