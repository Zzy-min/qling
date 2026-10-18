# RESULT 05：子 agent 初始化隔离 + 角色白名单兜底

- 实现者：pi 0.99.2。05a 写复现测试，05b 做实现，两步都在同一个会话 `qling-r2-05` 里完成。协调者没有手写实现代码。
- **实际使用的模型**：两步都只用了 `magpie / codex-router/grok-oauth/grok-4.7`，命令行参数为 `--provider magpie --model codex-router/grok-oauth/grok-4.7 --models magpie/codex-router/grok-oauth/grok-4.7`。
  - JSON 日志里 05b 共 244 条消息，全部是 grok-4.7。
  - 会话文件里另有 1 条 `openai-codex/gpt-5.6-sol`，是 19:53 那次额度用完、什么也没产出的失败尝试，它沿用了同一个会话 id。
- 没有 commit/push，没有读 .env，没有加依赖，package*.json 与 r2 快照完全一致。

## 05a 复现（改动前，只加了测试文件）
`tests/unit/subagent-isolation.test.mjs` 在当时的代码上通过，证明**泄漏存在**：
- 子 agent 的角色白名单是 `[read, search]`，init 之后工具列表变成 `[read, search, mcp__leak__leak_ping]`。
- MCP server 被 spawn 了 2 次：父 agent 1 次，子 agent 又 1 次。
- 子 agent 触发了 1 次 SessionStart。

## pi 改动的文件（以 05 开工前的快照 `r2\pre05\` 为基准）
| 文件 | 改动 | 是否与用户未提交改动重叠 | 是否在 brief 范围内 |
|---|---|---|---|
| `src/agent-loop.ts` | +101/−43。处理 `config.subagent`；子 agent 不发 SessionStart；子 agent 不新建 MCPRegistry，只有白名单显式包含 `mcp__*` 时才从父 registry 继承工具；新增 `setTools`、`getTools` | **是** | 是（brief 任务 2） |
| `src/types.ts` | +17。`AgentConfig.subagent` | **是** | 是（任务 1） |
| `src/agent/subtask.ts` | +40/−1。`waitForInit` 之后用 `sealSubagentTools` 再按角色过滤一遍作兜底；由父侧发 SubagentStart/SubagentStop | **是** | 是（任务 2、3） |
| `src/agent/subtask-parallel.ts` | +13/−1。新增 `sealSubagentTools`，并行子任务同样兜底 | 否 | 是（任务 3） |
| `src/hooks/json-hooks.ts` | +32/−5。新增 SubagentStart/SubagentStop 事件；新增 `emitSessionStart` 选项（子 agent 仍注册 Pre/PostToolUse） | 否 | 是（任务 2 隐含） |
| `src/agents/roles.ts` | +36/−6。`filterToolsForRole` 改为调用通用的 `filterToolsByAllowlist`，白名单可以写 `mcp__*` 通配 | 否 | **超出范围** |
| `src/runtime-services.ts` | +20/−3。`ownsRegistry`：子 agent 关闭时不断开父 agent 的 MCP 连接；新增 `setParentScope` | 否 | **超出范围** |
| `src/runtime/subagent-scope.ts` | 新增。用 AsyncLocalStorage 把父 agent 的 sessionId、registry、hookRunner 传给子 agent | — | **超出范围（新文件）** |
| `src/pipeline/hooks.ts` | +4。新增 `ToolPipeline.setToolDefs`，配合 `setTools` 使用 | **是** | **超出范围** |
| `tests/unit/subagent-isolation.test.mjs` | 新增。05a 的复现断言已翻转为"已隔离"，共 3 个测试 | — | 是 |
| `scripts/eval-subagent-isolation.mjs` | 新增。度量脚本，直接用 node 运行 | — | 是（brief 的度量要求） |
| `docs/agent-study/results/05-pre-eval.json`、`05-post-eval.json` | 新增。度量结果 | — | — |

没有做 brief 任务 4（`normalizeParentContext`），brief 标为可选。

## 偏离（需要确认）
1. **超出 brief 范围的文件有 4 个**：`roles.ts`、`runtime-services.ts`、`runtime/subagent-scope.ts`（新文件）、`pipeline/hooks.ts`（只加了一个 setter）。它们都是为了实现"复用父 registry 且不在子 agent 关闭时断开它""init 之后重设工具"而做的配套改动。
2. `src/agent-loop.ts` 本身就有用户的未提交改动，这次 pi 又在里面改了 +101/−43，改动量较大。用户原有的改动没有被回滚：这次对比的基准快照里已经包含了用户的改动，diff 只反映 pi 新加的部分。
3. 没有做可选的任务 4。

## 安全没有放宽：证据
- **角色白名单**：`filterToolsForRole` 新支持的 `mcp__*` 通配，只在白名单里显式写了通配时才会生效。
  - 测试 `builtin role allowlists do not include MCP tools; mcp__* is opt-in only` 遍历了所有内置角色：都不含 MCP 条目，过滤结果和原来"按名字精确匹配"完全一样。
  - 自定义角色在 `role-loader.ts:71-72` 会和内置角色的白名单取交集，所以写不进 `mcp__*`。
  - `use_tool`、`search_tool` 不会因为通配被放行，`subtask` 始终被剔除。
- **隔离测试**（测试 1）：explorer 子 agent 的工具列表就是角色白名单，不含 `mcp__*` 或 `use_tool`；MCP 只连接了父 agent 那 1 次；子 agent 没有发 SessionStart。
- **hooks 仍然生效**（测试 3）：子 agent 调用工具时 PreToolUse hook 照常触发；hook 返回 deny 时，子 agent 的这次工具调用被拒绝。
- 生命周期钩子 SubagentStart/Stop 如果执行失败，错误会被吞掉，但不会影响工具白名单（见代码注释）。
- 隔离测试 3 个全部通过。

## 测试结果
- `npm test`：共 1376，通过 1374，失败 1，跳过 1。唯一失败是基线就有的 `verify tool applies tail…`，**没有新增失败**。

## eval 前后对比
| 指标 | 改动前 | 改动后 |
|---|---|---|
| eval:smoke | 22/22 | 22/22 |
| eval:tasks | 11/11 | 11/11 |
| eval-subagent-isolation（配置 2 个 stdio MCP server） | 子 agent init 耗时 197ms，MCP 进程 spawn 4 次，泄漏的工具：`mcp__alpha__leak_alpha`、`mcp__beta__leak_beta`，子 agent SessionStart 1 次 | 子 agent init 耗时 33ms，MCP 进程 spawn 2 次，泄漏 0 个，子 agent SessionStart 0 次 |

注：改动前的度量是 pi 在修改任何 src 之前跑的。对比 `r2\pre05b\` 快照可以确认，05-pre-eval.json 生成时 src 还没有被改动。
