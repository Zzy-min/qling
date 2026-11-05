# Brief 07：Goal 停滞检测 + 评估器故障策略 + 过早放弃检测（qling）
约束：只改本地工作区，基于分支 `codex/agent-reliability-v3`，不 commit、不 push。改前跑 `npm test` 记录基线，改后不得新增失败；`npm run eval:recovery`、`npm run eval:tasks` 前后对比。
参考思路（TS 重写，不拷贝）：grok-build `xai-grok-shell/src/session/goal_tracker.rs`（GoalStatus、STALL_THRESHOLD=2、未知状态→UserPaused）、`goal_classifier.rs` `gap_fingerprint`、`goal_stop_detector.rs`；书 §5.1.5、§7.4.2、§9.3.1。

## 任务
1. `session-goal-manager.ts`：
   - status 增加 `paused_no_progress | paused_budget | paused_infra`（可用 `/goal resume` 恢复为 active）；
   - `loadGoal` 校验 status，未知或损坏一律当作 `paused_infra`，绝不能是 active；JSON 损坏时尝试 `.bak`；
   - `saveGoal` 改用 `persistence/atomic-json.ts` 的 `atomicWriteJson(..., {backup:true})`；
   - 记录 `history: {at, reason, fingerprint}[]`，上限 64 条。
2. `goal-controller.ts` `afterTurn`：
   - `fingerprint = normalize(reason)`（去掉数字、路径中的行号、空白，转小写后取 sha1 前 12 位）；与上一条相同则计数 +1，达到 `QLING_GOAL_STALL_THRESHOLD`（默认 2）→ `paused_no_progress`，返回 `status:"paused"`；
   - 超出轮数上限 → `paused_budget`（不再 clearGoal；保留旧 env 开关语义：evidence 模式仍是 blocked）；
   - 评估器异常（throw / 缺 key / 无法解析）统一归类为 `evaluator_error`，不计入停滞；连续 2 次 → `paused_infra`（fail-closed）。
3. `goal-evaluator.ts`：`evaluate` 内部 catch 网络和超时错误，返回 `{done:false, error:"network"|"timeout"|"no_key"|"unparseable"}`。
4. 新增 `src/session/premature-stop.ts`：取最后一个非空段落，中英文正则各一组（如"我无法继续|无法完成|先到这里|暂停在此|请你(手动|自行|运行|提供)|等.{0,20}(完成|跑完)后再|已提交.{0,10}commit|I can't proceed|Giving up|Stopping here"），返回 pattern 标签；命中且目标仍 active 时，continuationPrompt 换成"不要交还给用户，先尝试其他方案"类文本，并 emit 事件。
5. 调用方 `tui/streaming-repl.ts:515`、`agent/durable-session-supervisor.ts:156`、`repl.ts:217`：用 try/catch 包住 afterTurn；处理 `paused` 状态的 UI 提示（目前 blocked 也没有提示）。

## 测试
停滞：评估器连续两次返回相同 reason → paused_no_progress；超出轮数 → paused_budget 且可 resume；评估器抛错两次 → paused_infra；损坏的 goal 文件不会以 active 加载；premature-stop 各 pattern 的正例和反例（"等你确认后"不应命中）。
## 度量
eval:recovery 通过率；人为制造永远无法达成的目标，记录自动轮数（预期从 12 降到 ≤3）和 token 消耗。
