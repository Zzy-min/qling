# `qingling` 阶段 B：Session Goal 与自动续跑设计（2026-05-16）

## 背景

阶段 B 现在已经具备：

1. `mission` / daemon 后台管理面。
2. session-scoped `/loop`、`/tasks`、`/compact`。

但还缺一个更接近 Claude Code `/goal` 的自治能力：不是按时间轮询，而是“每次当前 turn 结束后，判断目标条件是否已经满足；如果没有，就自动继续下一 turn”。

## 对标语义

参考 Claude Code 官方文档（2026-05-16 核对）：

1. `/goal` 是 session-scoped。
2. 设置 goal 后立即开始一个 turn。
3. 每个 turn 结束后，用独立 evaluator 判断 condition 是否满足。
4. evaluator 不跑工具，只能根据对话里已经 surfaced 的证据做判断。
5. 未满足时，给出简短 reason，并作为下一 turn 的指导继续工作。
6. `/goal` 无参数查看状态，`clear|stop|off|reset|none|cancel` 清除。

## 目标

1. 新增 `/goal [condition|clear]`。
2. 在当前 session 内持久化 goal 状态。
3. 每个 turn 结束后自动评估 condition。
4. condition 未满足时自动续跑下一 turn。
5. `/goal` 无参数时可查看当前或最近一次 goal 状态。

## 非目标

1. 本轮不实现跨新进程/`--resume` 的 goal 恢复。
2. 本轮不把 goal 提升为 daemon-backed durable task。
3. 本轮不接入真正的 hooks 系统或 provider-specific small-fast model 选择器。
4. 本轮不实现多个 goal 并存；每个 session 只允许一个 active goal。

## 方案

### A. Goal 状态持久化

- 新增 session goal 状态文件：
  - `<runtime.file_state_dir>/session-goals/<sessionId>.json`
- 记录字段至少包含：
  - `condition`
  - `status=active|achieved|cleared`
  - `createdAt`
  - `updatedAt`
  - `achievedAt`
  - `clearedAt`
  - `baselineTurns`
  - `baselineTokens`
  - `evaluatedTurns`
  - `lastReason`
  - `lastDecision`

### B. 独立 evaluator

- evaluator 使用单独 prompt，对 condition 与 conversation transcript 进行 yes/no 判定。
- 输出严格 JSON：
  - `{"done": true|false, "reason": "..."}`
- evaluator 不运行工具，只读 transcript。
- provider/model 选择：
  - 优先读 `QINGLING_GOAL_EVALUATOR_*`
  - 否则回退主 session 的 `QINGLING_LLM_*`
- 诚实边界：
  - 当前不会像 Claude Code 一样自动路由到“small fast model”。
  - 如果用户没有额外配置，goal evaluator 默认复用当前 provider/model。

### C. 自动续跑

- `/goal <condition>` 设定后立即触发一个 turn。
- 该 turn 结束后：
  - evaluator 若返回 `done=true`：
    - goal 标记为 `achieved`
    - 自动停止续跑
  - evaluator 若返回 `done=false`：
    - 将 `reason` 写入 goal 状态
    - 立即发起下一 turn
- 下一 turn 的 prompt 模板：
  - 明确目标 condition
  - 注入 evaluator 的最新 reason
  - 要求只做最有效的下一步，并把可验证证据写入对话

### D. 安全收敛

- 内部增加硬上限：
  - `QINGLING_GOAL_MAX_AUTO_TURNS`
  - 默认 `12`
- 超过上限后自动清除 goal，并在 transcript/状态里记录停止原因。
- 这是本轮对抗失控循环的保护措施。

### E. Slash 契约

- `/goal <condition>`
  - 替换当前 active goal
  - 立即启动自动续跑
- `/goal`
  - 查看当前 active goal，或最近一次 achieved/cleared goal
- `/goal clear`
  - 清除当前 active goal
- 接受别名：
  - `clear`
  - `stop`
  - `off`
  - `reset`
  - `none`
  - `cancel`

### F. 与现有 `/loop` 交互

- 当 goal 自动续跑链路还在执行时，session scheduler 继续保持 `busy=true`。
- 已到时的 `/loop` 任务只标记 `pending`，不插入当前 goal 链路。
- 等 goal 链路结束后，再统一冲洗 pending loop。

## 测试策略

1. 单元测试：
  - goal manager 创建、清除、达成、状态查看
  - goal evaluator 响应解析
  - goal controller 在未达成时返回 continuation prompt，在达成时停止
  - slash `/goal` 设定、查询、清除
2. Smoke 测试：
  - 真实 goal 状态文件可落盘
  - mock evaluator 下能完成 `set -> evaluate false -> evaluate true -> achieved`

## 验收

1. `/goal <condition>` 会立即开始自动续跑。
2. 每个 turn 后都会有独立评估，不依赖主 AgentLoop 自己“觉得完成了”。
3. `/goal` 可查询状态，`/goal clear` 可提前停止。
4. goal 运行中不会打断已有 loop task，只会延后它们。
5. `npm run build` 与 `npm run ci:check` 全通过。
