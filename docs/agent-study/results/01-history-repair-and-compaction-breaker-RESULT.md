# RESULT 01：发送前历史修复 + 压缩熔断

- 实现者：pi 0.99.2（`pi -p`，会话 `qling-agent-study-01`，共 2 轮：实现 + 默认值回退修正）；协调者未手写实现代码。
- 仓库基线：HEAD `5fe7240`，工作区原本就有 55 个已修改文件和若干未跟踪文件（快照：`%TEMP%\qling-agent-study\baseline.diff` / `baseline-status.txt` / `baseline-hashes.txt`）。下面的改动是**和基线快照逐文件对比后、只属于 pi 的部分**。
- 未 commit、未 push、未读 .env、未加依赖，package*.json 未改动。

## 环境准备（不是代码改动）
- 仓库原来没有 node_modules：先跑了 `npm ci`，按现有 lock 安装。npm 12.0.2 默认拦截依赖的安装脚本，所以又跑了 `npm rebuild ...`，并在 `node_modules/better-sqlite3` 下直接执行 `prebuild-install` 补上原生 binding。这些只影响 node_modules。
- 补好后基线 `npm test`：共 1301，通过 1299，失败 1，跳过 1。

## 基线失败清单（`%TEMP%\qling-agent-study\baseline-failures.txt`）
- `not ok 1175 - verify tool applies tail as an output view and preserves the full artifact`
  - 原因：本机 npm 12.0.2 运行脚本时会打印 `npm notice run <script>` 横幅，横幅原样带出了 `node -e "console.log('one');..."` 这段命令文本。测试里 `tail` 视图断言 `doesNotMatch(/one/)`，于是被横幅命中。
  - 这个失败和 npm 版本 / 测试夹具有关，与本次改动无关，没有修。
- **偏离「全绿」**：验收口径改为「不比基线多出新的失败，且本份新增测试全部通过」（已获确认）。

## pi 改动的文件（相对基线快照）
| 文件 | 改动量 | 内容 |
|---|---|---|
| `src/context-history-repair.ts`（新增，116 行） | 新文件 | 纯函数 `repairHistory`：同一 tool_call_id 的重复 tool 消息去重（保留首个）；剥离孤儿 / 错位 tool 结果；对未应答的 tool_call 插入合成 tool 消息（`synthetic_reason:"history_repair"`，内容 `[工具未返回结果：执行被中断]`）；幂等。report 字段：`duplicatesRemoved / strippedToolResultIds / syntheticResultsInserted / changed` |
| `tests/unit/context-history-repair.test.mjs`（新增，107 行） | 新文件 | 5 个用例：重复、孤儿、错位（中间插 user）、未应答、幂等 |
| `src/context-compactor.ts` | +70 / −11 | 摘要短于 `minSummaryChars` 或抛错时计一次失败；会话级 `consecutiveFailures`，达到 `QLING_COMPACTION_BREAKER`（默认 3）后跳过 LLM，直接走 `buildLocalFallbackSummary`；LLM 摘要达标后清零；`compactDetailed` 返回 `summarySource / consecutiveFailures / breakerOpen / historyRepair`；压缩输出再过一遍 `repairHistory`；新增 `resetBreaker()`、`getCompactionState()` |
| `src/agent/main-loop.ts` | +11 | 在调用 provider 的 chat 之前跑 `repairHistory`；`report.changed` 时原地替换 `host.messages`，并 `host.emit("history_repair", report)` |
| `tests/unit/context-compactor.test.mjs` | +94 | 3 个用例：连续空摘要触发熔断并跳过 summarizer；有效摘要清零；压缩输出经过历史修复 |
| `src/types.ts`（说明范围外，已确认保留） | +2 / −1 | `SyntheticReason` 增加 `"history_repair"` |
| `src/agent-loop.ts`（说明范围外，已确认保留） | +2 | 重建 compactor 时传入 `breakerThreshold`；`reset()` 时调用 `compactor.resetBreaker()` |
| `src/config.ts` | 内容 0 行变化 | pi 曾把默认值改成 200，按指示改回 500；现在内容与基线相同，只是文件哈希变了（换行符） |

## 偏离点及处理
1. **默认值**：brief 要求「默认 200」。按用户决定，**保持原来的默认值 500**：`config.ts`、`agent-loop.ts` 的回退值、compactor 的 `options.minSummaryChars ?? 500` 都和以前一致。新增测试里显式传 `minSummaryChars: 200`。
2. **范围外文件**：`types.ts`、`agent-loop.ts` 两处小改动，已确认保留。
3. **熔断语义（已确认）**：熔断打开后用本地兜底生成摘要，本地兜底**不会**清零计数；靠会话 `reset()` / `resetBreaker()` 恢复。只有 LLM 摘要达标才清零。
4. compactor 走 skipped（无需压缩）路径时不跑 `repairHistory`，以免破坏已有的「孤儿 tool 保留」测试。发送前主循环会对完整历史统一修复。
5. `QLING_COMPACTION_BREAKER` 没有加进 config 字段，compactor 直接读环境变量。

## 测试结果
- `npm test`（改动后最终一次）：共 1309，通过 1306，失败 2，跳过 1。
  - `verify tool applies tail…`：基线已有的失败。
  - `repl slash loop runs due task from local scheduler timer`：Windows 上 `EPERM rename` 临时文件，属于偶发失败。单独重跑 3/3 通过，和本次改动无关（这个测试不涉及 compactor 或历史修复）。pi 自己那次全量跑的结果只有 1 个失败。
- 新增测试 8 个全部通过（5 个 repairHistory + 3 个 compactor）。compactor 测试文件整体 19/19 通过。

## eval 前后对比
| eval | 改动前 | 改动后 |
|---|---|---|
| eval:smoke | 22/22 通过 | 22/22 通过 |
| eval:recovery | ok=true，fixtures=15，finalSuccessRate=1，automaticRecoverySuccessRate=1 | 完全一致 |
| provider 400 次数 | 无法测量：两个 eval 都是 deterministic-no-model，不请求 provider，run-trace-store 没有 400 记录 | 同左 |

注意：现有 eval 都没覆盖历史修复和熔断这两项新行为，它们的效果只由新增单测证明。
