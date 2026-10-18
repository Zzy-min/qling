# Brief 06：轮中增量检查点 + 中断轮检测 + mission/后台任务对账（qling）
约束：同 Brief 04；另跑 `npm run eval:recovery` 前后对比。
参考思路：grok-build `crates/codegen/xai-grok-shell/src/session/interrupted_turn.rs`（`detect_interrupted_turn`、`EVENTS_TAIL_BYTES`、`close_events_turn`、`model_reminder`）、`crates/codegen/xai-grok-session-events/src/{log,types}.rs`（`TurnOutcomeLabel::Interrupted`）；书 §5.1.5。

## 任务
1. 轮中检查点：在工具结果写入 `this.messages` 后（agent/main-loop.ts 或 tool-orchestrator 回调处）节流调用 `checkpointSession()`（默认每批工具完成后、最少间隔 `QLING_CHECKPOINT_MIN_INTERVAL_MS=2000`；复用 atomic-json 队列，不阻塞主循环——失败只记一次告警）。
2. 中断检测（新文件 `src/session/interrupted-run.ts`，纯函数 + 小 IO）：
   - 恢复会话时，若快照 `activeRun` 存在且 `recoveryState?.status!=="recovering"`，读 `RunTraceStore` 对应 run 文件尾部 ≤256KB（从首个换行后截断），若有 `run_started` 无 `run_completed` → 判定中断；
   - 追加 `run_completed{status:"interrupted"}`（扩展 `ExecutionRunStatus`），清空 activeRun；
   - 向消息尾部注入一条 system/user 提醒："上一轮在完成前被中断（进程退出或重启），已保存的工具结果保留，之后的工作可能丢失；请先核对状态再继续。"；配合第 1 轮 `repairHistory` 补齐未应答 tool_call。
   - 幂等：二次加载不重复提醒。
3. mission 对账：`MissionManager.init()` 后，对 `status==="running"` 的 mission 若无存活 owner（记录 `ownerPid` + `process.kill(pid,0)` 检查；旧数据无 pid 视为不存活）→ 转 `blocked`，`reason:"interrupted_on_restart"`，写 MissionEvent。
4. 后台任务输出：`runtime/background-tasks.ts` `truncateBytes` 改为头 64KB + `…[省略 N 字节]…` + 尾部，总上限不变。

## 测试
构造只有 run_started 的 jsonl → 检测为中断并只提醒一次；有 run_completed → 不提醒；尾部截断首行半行被丢弃；mission running+死 pid → blocked；后台输出头尾保留。
## 度量
eval:recovery 通过率；人工 kill -9 中途进程后 `!load`，检查工具结果保留条数与提醒出现。
