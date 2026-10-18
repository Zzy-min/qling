# 09 ACP 流式输出 + loadSession + prompt 排队 + stdout 守卫 — RESULT

- 分支 `codex/agent-reliability-v3`，HEAD `a5fd5dd`；未 commit / push。
- 实现：pi，会话 `qling-r3-09`，模型只用 `magpie/codex-router/grok-oauth/grok-4.7`，命令末尾加 `< NUL`。共派发两次：
  - 第一次在 11:21（UTC+8）因网关错误 `The Grok gateway could not complete the upstream response stream.` 中断，代码没写完，构建失败（`acp-server.ts` TS2345）。
  - 第二次用同一会话续做：修好构建、补齐剩余部分。11:41 最后一轮又报同样的网关错误，但代码已写完，测试和 eval 都已通过。
- 协调者未手写代码，只做只读复核。

## 改动文件（与 `%TEMP%\qling-agent-study\r3\pre09` 快照对比）
- `src/cli/acp-server.ts`（主体）
- `src/types.ts`
- `src/index.ts` ⚠ **与用户原有未提交改动是同一个文件**
- `tests/unit/acp-server.test.mjs`（调整：initialize 现在声明 loadSession）
- `tests/unit/acp-streaming-load-queue.test.mjs`（新，25 个用例）
- `scripts/eval-acp-stream.mjs`（新）、`docs/agent-study/results/09-{pre,post}-acp-stream.json`

## npm test
- 本轮基线：1386 项，通过 1384，失败 1，跳过 1。
- 改动后：1450 项，通过 1448，失败 1，跳过 1。唯一失败为基线用例 `verify tool applies tail as an output view and preserves the full artifact`。无新增失败，新测试全部通过。

## Eval 前后
| 指标 | 改前 | 改后 |
|---|---|---|
| eval:smoke | 通过 | 通过（22/22） |
| eval:tasks | 11/11 | 11/11 |
| eval-acp-stream：首个 chunk 到达时间（20 段 × 50ms 的 mock 流） | 1237ms（等全文） | 265ms |
| chunk 数 | 1 | 5（按 ≥200ms 或 ≥1KB 合并发送） |
| 拼接后与全文一致 | 是 | 是 |
| 同一会话并发第二个 prompt | 报错 | 排队，按顺序完成 |
| loadSession | 不支持 | 支持 |

brief 要求用 ACP 客户端手工冒烟测试。这里用 SDK 内存流 client 测试桩代替，包括 `runAcpStdioServer` 端到端用例，没有用真实 IDE 客户端测试。

## 行为变化
- 文本增量流式发送 `agent_message_chunk`，轮末不再重复发全文；只有完全没有增量时才发全文兜底。
- `tool_call` 带 `rawInput`（截断到 4KB），`tool_call_update` 带输出摘要（截断到 2KB）；plan / todo 事件映射为 `plan` 更新。
- 初始化时声明 `loadSession: true`，支持 `session/load`：
  - 回放历史 user / assistant 消息，工具调用回放为 completed；
  - 如果上次运行被中断，回放一条中断提醒，并且不会重复添加。
- 同一会话的 prompt 排队，上限 `QLING_ACP_MAX_QUEUED`（默认 4），超出时报错。正在运行的 prompt 被 cancel 时，清空队列，排队中的 prompt 返回 `cancelled`。
- RunOutcome 为 paused / recovering / exhausted 时，返回 `end_turn` 并附一条说明，不再 throw；不可恢复的 failed 仍 throw。
  - ⚠ 轻微偏离：brief 只列了 paused 和 recovery，pi 把 exhausted（步数耗尽）也算作软停止。
- `runAcpStdioServer` 期间，`console.log/info/debug` 改写到 stderr，退出时还原；协议本身的 stdout 写入不受影响。
- 会话空闲超过 `QLING_ACP_SESSION_IDLE_MS`（默认 30 分钟）且没有正在运行的 prompt 时，关闭会话并从 Map 中删除。

## 安全没有放宽的依据（测试名）
- 仍拒绝客户端注入 MCP servers 或 additionalDirectories：
  - `acp: newSession still rejects client MCP servers and additionalDirectories`
  - `acp: loadSession rejects client MCP servers and additionalDirectories`
  - `acp: rejects unimplemented client MCP injection instead of ignoring it`
- 审批不被流式或排队绕过：
  - `acp: streaming still asks for permission before a tool runs`
  - `acp: a queued prompt still requests permission`
  - `acp: approval rawInput is truncated and still goes through requestPermission`
- cancel 后排队的 prompt 不会执行工具：`acp: cancelling the active prompt cancels the queue before it runs tools`
- loadSession 的会话 id 校验：
  - 在查会话存储之前，就拒绝路径分隔符、`..`、绝对路径和控制字符（`validateAcpSessionId`）：`acp: loadSession rejects unsafe ids before touching the session store`
  - 只能加载 qling 自己存储里的会话：`acp: loadSession returns invalidParams when the id is not in qling's store`
- 大输出不会整段推给客户端：`acp: tool_call rawInput and tool output stay inside 4KB and 2KB`
- stdout 守卫：
  - `acp: stdout guard redirects console log/info/debug and leaves protocol writes alone`
  - `acp: runAcpStdioServer restores console methods and does not put logs on the protocol stream`
- 不可恢复的错误仍 throw：`acp: an unrecoverable failed outcome still throws`

## 偏离
1. exhausted 也映射为 `end_turn`（见上），只影响结束方式，不涉及权限。
2. 手工冒烟测试用 SDK 内存流测试桩代替。
3. pi 两次都在最后一轮报网关错误，最终总结没有完整输出。本 RESULT 依据协调者的只读复核和脚本跑出的测试、eval 结果写成。

## 仓库根目录
- 第一次派发时，pi 自己执行 shell 命令（类似 `rg ... 2>nul`）在仓库根目录生成了一个 114 字节的 `nul` 文件，内容是 rg 的报错文本。不是测试生成的。
- 协调者确认它不在基线里、由本次 pi 生成后，已删除（Windows 保留名，用 `\\?\` 路径删除）。
- npm test 后没有其他新增未跟踪文件，也没有 `sessions/`。
