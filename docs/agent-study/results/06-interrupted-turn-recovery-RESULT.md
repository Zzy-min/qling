# RESULT 06：轮中增量检查点 + 中断轮检测 + mission/后台任务对账

- 实现者：pi 0.99.2（`pi -p`，会话 `qling-r2-06`）。协调者没有手写实现代码。
- **实际用的模型**：只用了 `magpie / codex-router/grok-oauth/grok-4.7`。JSON 日志里一共 252 条消息，全部是这个模型，没有退回到其他模型，也没有报错或限速。
- 没有 commit/push，没有读 .env，没有加依赖。package.json 和 package-lock.json 与 r2 快照的哈希一致。
- 改动的对比基准是开工前拍的快照 `%TEMP%\qling-agent-study\r2\pre06\`，已包含 04、05 的改动。

## pi 改动的文件
| 文件 | 改动 | 是否与用户未提交改动重叠 | 是否超出 brief 范围 |
|---|---|---|---|
| `src/session/interrupted-run.ts` | 新增。读取 run trace 尾部最多 256KB，丢掉第一行可能被截断的半行；只有 `run_started`、没有 `run_completed` 时判定为中断；追加 `run_completed{status:"interrupted"}`；注入中断提醒，并做幂等（重复加载不重复提醒） | — | 否 |
| `src/agent/main-loop.ts` | +77。工具结果写入后按节流做检查点（默认间隔 2000ms，走 atomic-json 队列，不阻塞，写失败只告警） | **是** | 否 |
| `src/agent-loop.ts` | +25。恢复会话时调用中断检测 | **是** | 否（brief 第 2 条的恢复路径） |
| `src/execution/types.ts` | +2/−1。`ExecutionRunStatus` 增加 `"interrupted"` | **是** | 否 |
| `src/types.ts` | +2/−1。`SyntheticReason` 增加 `"interrupted_run"` | **是** | 否（提醒消息需要这个类型） |
| `src/context-compactor.ts` | +2/−1。压缩时把 `interrupted_run` 当作确定性系统消息处理 | **是** | **超出（很小）** |
| `src/mission/manager.ts` | +39/−1。启动时对账：`running` 状态且 owner 进程已不存在的 mission 转为 `blocked`，原因记为 `interrupted_on_restart`；进入 running 时记录 `ownerPid` | 否 | 否 |
| `src/mission/types.ts` | +6。新增 `ownerPid?` | 否 | 否 |
| `src/runtime/background-tasks.ts` | +126/−31。`truncateBytes` 改为保留头部 64KB + 省略标记 + 尾部，处理了 UTF-8 边界；新增 `BoundedOutput`，流式输出时也能保留尾部 | 否 | 否（`BoundedOutput` 属于实现细节，量较大） |
| `tests/unit/interrupted-run.test.mjs` | 新增 | — | 否 |
| `tests/unit/mission-manager.test.mjs` | +124/−1 | 否 | 否 |
| `tests/unit/background-tasks.test.mjs` | +50 | **是** | 否 |
| `tests/unit/main-loop.test.mjs` | +63 | **是** | 否 |
| `scripts/eval-interrupted-run.mjs` | 新增。确定性度量脚本，直接用 node 运行 | — | 否（brief 的度量项） |
| `docs/agent-study/results/06-pre-eval.json`、`06-post-eval.json` | 新增 | — | — |

**标注**：
- 有 7 个文件是用户本来就有未提交改动的文件。pi 都只做了增量修改；最大的是 `main-loop.ts` 的 +77，没有删除用户的内容。
- 超出 brief 范围的只有 `context-compactor.ts` 的 1 行。

## 安全和行为没有放宽，证据
- **mission 对账**：
  - 只会把 `running` 改成 `blocked`，不会新建、删除或恢复 mission（见代码注释和 `reconcileInterruptedMissions` 的过滤条件）。
  - 存活检查只发送 0 号信号：`MissionProcessProbe` 的类型就把 signal 限定为字面量 `0`。测试 `isMissionOwnerAlive probes with signal 0 only` 断言了这一点。
  - 探测结果是 EPERM 时（进程存在但无权限）按"存活"处理，所以不会误判为已退出。
- **中断提醒**：只追加一条消息，不删除已保存的工具结果。测试 `an open run trace is interrupted once and keeps saved tool results` 验证了这一点。另外，`recovering` 状态的 run 不会被标记为中断，有专门测试。
- **后台任务输出上限**：测试 `background output keeps the head and tail inside the same byte cap` 断言总字节数不超过上限。旧实现是在 `maxBytes` 之后再追加 `[truncated…]` 标记，实际会略微超出上限；新实现严格不超过，比原来更严。
- **检查点**：测试 `session checkpoint interval defaults to 2000ms and does not block the caller` 验证了默认间隔是 2000ms，且不阻塞调用方。
- 相关的 4 个测试文件单独跑：53 个测试，52 通过，1 个跳过，0 失败。

## 测试结果
- `npm test`：共 1385，通过 1383，失败 1，跳过 1。唯一失败是基线就有的 `verify tool applies tail…`，**没有新增失败**。

## eval 前后对比
| eval | 改动前 | 改动后 |
|---|---|---|
| eval:smoke | 22/22 | 22/22 |
| eval:tasks | 11/11 | 11/11 |
| eval:recovery | ok，15 个 fixtures，finalSuccessRate 1 | 完全一致 |
| eval-interrupted-run（一轮 3 个工具调用，执行到中途进程被杀） | 保留的工具结果 2 条；未检测到中断；提醒 0 次；mission 重启后仍是 running；后台输出没有保留尾部 | 保留的工具结果 2 条；检测到中断；提醒 1 次，重新加载后仍是 1 次（幂等）；mission 变为 blocked；后台输出保留了尾部 |

**说明**：
- 改动前的数据由 pi 在修改 src 之前采集。
- brief 要求的"人工 `kill -9` 后 `!load`"没有做真实的人工操作，用确定性脚本模拟代替。
- 改动前后"保留的工具结果"都是 2 条。这说明脚本只模拟了快照里已经存在的结果，没有体现轮中检查点带来的增量。检查点本身的行为由 main-loop 的单元测试证明。

## 验收中发现的问题（待处理）
- 仓库根目录多出一个未跟踪的 `sessions/` 目录，里面有 6 个 `session-*.json`，每个约 27KB。生成时间是 21:31 和 21:34，正好对应改动后两次跑 `npm test` 的时间（pi 跑了一次，验收又跑了一次）。
- 推测原因：新加的轮中检查点在测试里被触发了。触发它的测试没有设置 stateDir，于是快照按相对路径写到了当前工作目录下的 `sessions/`。
- 影响：每跑一次测试，仓库里就会多出这些文件。如果真实运行时 stateDir 也可能没设置，检查点同样会写进 cwd。
- 处理建议：让 pi 修改检查点路径（stateDir 为空时跳过写入，或写到临时目录），或者给相关测试注入临时 stateDir，然后再删除 `sessions/`。我没有自行删除这个目录。

## 副作用修复：仓库根目录出现 sessions/（2026-10-12 22:5x UTC+8）

**问题**：06 首次验收后，跑 `npm test` 会在仓库根目录生成 `sessions/session-*.json`（6 个，每个约 27KB）。根因：`tests/unit/agent-loop-tool-args.test.mjs` 里的用例把 `fileStateDir` 设成 `process.cwd()`，轮中检查点就写到了 `<repo>/sessions/`。另外，`stateDir` 为空或是相对路径时，原来会按 cwd 去解析。

**修复**（由 pi 实现，模型 `magpie/codex-router/grok-oauth/grok-4.7`；pi 最后一轮报了路由流超时，只影响它的总结输出。下面的代码和验证都由协调者独立复核）：
- `src/agent/main-loop.ts`：新增 `canWriteMidTurnCheckpoint(stateDir)`，只有非空的绝对路径才返回 true。`InnerLoopHost` 新增 `checkpointStateDir`，判定不通过时不创建检查点调度器，并只记一次 `console.debug`。
- `src/agent-loop.ts`：保存 path.resolve 之前的原始 `requestedFileStateDir`，传给 `checkpointStateDir`，`checkpointSession` 里也做同样的判定。默认值 `~/.qling` 是绝对路径，所以默认配置下轮中检查点照常工作。
- `tests/unit/agent-loop-tool-args.test.mjs`：5 个用例的 `fileCacheDir`/`fileStateDir` 改为 `beforeEach` 里 `mkdtemp` 建的临时目录，在 `afterEach` 里清理。
- `tests/unit/main-loop.test.mjs`：新增回归测试 "mid-turn checkpoint skips an empty or relative stateDir and does not create cwd/sessions"，断言 `""`、空白、`"."`、`"sessions"`、`undefined` 都会被拒绝；给 `checkpointStateDir: ""` 跑一轮工具调用后，`checkpointSession` 的调用次数为 0，cwd 下的 `sessions/` 也不变。

**行为说明**：轮中检查点只多加了跳过条件，没有放宽任何权限或隔离。代价是：用户显式配置相对路径的 `fileStateDir` 时，不再做轮中检查点；轮末保存不受影响。

**验证**：
1. 先删除根目录 `sessions/`，再跑 `npm test`：tests 1386 / pass 1384 / fail 1 / skipped 1。唯一的失败是基线里就有的 `verify tool applies tail as an output view and preserves the full artifact`，没有新增失败。新回归测试（ok 407）和 06 的其他测试都通过。
2. `npm test` 跑完后，`Test-Path sessions` 返回 False，没有再生成。最终仓库里没有 `sessions/`。
3. `node scripts/eval-interrupted-run.mjs`：`{"toolResultsKept":2,"toolCallsInRound":3,"interruptedDetected":true,"reminderCount":1,"reminderCountAfterReload":1,"missionStatusAfterRestart":"blocked","bgOutputKeepsTail":true}`，和修复前一致。
