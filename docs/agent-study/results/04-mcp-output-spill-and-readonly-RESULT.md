# RESULT 04：MCP 输出落盘 + 只读标记纠正 + Plan Mode 拦截

- 实现者：pi 0.99.2（`pi -p`，会话 `qling-r2-04`）。协调者没有手写实现代码。
- 仓库：分支 `codex/agent-reliability-v3`，HEAD `44e970c`；用户有 92 项未提交改动。
- 基线快照：`%TEMP%\qling-agent-study\r2\`（`baseline-status.txt`、`baseline.diff`、`snap\`）。
- 没有 commit/push，没有读 .env，没有加依赖，package.json 和 package-lock.json 与快照完全相同（哈希一致）。
- 中途 PC 掉线约 10 分钟。pi 和验收命令是用 Start-Process 在后台跑的，掉线期间照常跑完，没有重新派发。

## 基线
- `npm test`：共 1360，通过 1358，失败 1，跳过 1。
- 失败清单（`r2\baseline-failures.txt`）只有 `verify tool applies tail as an output view and preserves the full artifact`。原因：npm 12 打印的 `npm notice run` 横幅混进了输出，和本次改动无关。

## pi 改动的文件（与 r2 快照逐文件对比）
| 文件 | 改动 | 是否与用户未提交改动重叠 |
|---|---|---|
| `src/mcp/registry.ts` | +164/−6。新增 `spillMcpResult`：超出上限的输出写到 `sessions/<id>/mcp/<sanitize(callId)>.json\|txt`，并校验路径不越界；内联部分按 UTF-8 安全截取前缀，附上路径指针和读取提示；写盘失败时退回旧行为；meta 里加 `spillPath`；支持按 server 单独设置 `max_output_bytes` | 否 |
| `src/mcp/types.ts` | +8。新增 `annotations?`、`max_output_bytes?` | 否 |
| `src/mcp/client.ts` | +7。把 `annotations` 透传下去 | 否 |
| `src/mcp/bridge.ts` | +3/−1。`readOnly`/`destructive` 只有在对应 hint `=== true` 时才为 true，未声明一律按 false | 否 |
| `src/pipeline/hooks.ts` | +8/−3。`use_tool` 加入 `PLAN_MODE_HARD_DENY_TOOLS`；Plan Mode 下所有非只读的 `mcp__*` 都硬拒绝；`buildHookContext` 里，找不到定义的 `mcp__*` 工具默认 `isReadOnly=false` | **是**（用户已有未提交改动，只做了增量修改） |
| `src/types.ts` | +2。agent-loop 用的 `MCPServerConfig` 增加 `max_output_bytes?` | **是**（只做了增量修改） |
| `src/eval/repo-tasks.ts` | +47。`eval:tasks` 新增 `fixture-mcp-spill-pointer` 任务 | 否 |
| `tests/unit/mcp-spill.test.mjs` | 新增，6 个测试 | — |
| `tests/unit/mcp-readonly-planmode.test.mjs` | 新增，6 个测试 | — |
| `tests/unit/mcp-bridge.test.mjs` | +37/−1。原断言"MCP 工具 readOnly=true"改为 false（这是本次的预期变化），并加了 annotations 映射用例 | 否 |
| `tests/unit/tool-catalog.test.mjs` | +21/−9。旧的 `truncateMcpResult` 测试改成用 `spillMcpResult` 加临时目录；UTF-8 字节边界仍由 mcp-spill 测试覆盖 | 否 |

## 偏离点（都是小的，已核对）
1. `src/eval/repo-tasks.ts`：brief 写的是"`eval:tasks` 或其 fixture 机制"，而 `scripts/eval-tasks.mjs` 实际跑的就是这个文件，所以在这里加任务。
2. `src/types.ts`：项目里有两个 `MCPServerConfig`，agent-loop 读配置用的是这一个，所以同步加了字段。
3. `hooks.ts` 的 `buildHookContext`：没有定义的 `mcp__*` 工具，原来默认判为只读，现在默认判为非只读。这比原来更严。

## 安全没有放宽：证据
- **只读标记**：原来所有 MCP 工具一律 `readOnly=true`，现在只有声明了 `readOnlyHint===true` 的才是 true。`mcp-bridge.test.mjs` 和 `mcp-readonly-planmode.test.mjs` 都有断言：没声明 annotations 的工具 `readOnly=false`。
  - 我还查了代码里所有用到 readOnly / isReadOnly 的地方（hooks.ts:228 的推测性分类、tool-capability.ts:48、Plan Mode 判断）。只读为 true 时才会放行或判为安全，所以把默认值改成 false 只会让判定更严。
- **Plan Mode**：
  - 测试逐个检查原 `PLAN_MODE_HARD_DENY_TOOLS` 里的每个工具，全部 deny。
  - write/patch 写到计划目录以外的路径时仍然 deny。
  - 新增的拒绝：`use_tool`、没有只读声明的 `mcp__x__write`。
  - 只有声明了 `readOnlyHint===true` 的 MCP 工具会被放行。
  - 代码改动只往拒绝条件里加了 `||` 分支，没有删掉任何拒绝。
- **非 Plan Mode**：测试里写死了 9 组改动前的判定结果，例如 `rm -rf /`→deny、`bg_reconcile`→ask、`mcp__db__write`→allow，改动后完全一致。
- 新增的 3 个 MCP 测试文件单独跑，18/18 通过。

## 测试结果
- `npm test`：共 1373，通过 1371，失败 1，跳过 1。唯一失败仍是基线就有的那一项，**没有新增失败**。新增的 12 个测试和改过的测试全部通过。

## eval 前后对比
| eval | 改动前 | 改动后 |
|---|---|---|
| eval:smoke | 22/22 | 22/22 |
| eval:tasks | 10/10 | 11/11（新增 `fixture-mcp-spill-pointer` 通过：100KB 以上的 JSON 输出被落盘，内联内容带路径和 jq/node 提示，落盘文件与原文一致，用 `node -e` 能读回 `items[7].id=7`） |

另外：brief 里"让真实模型按提示用 bash 读回"这一项没有做。这里只用确定性的 `node -e` 验证了文件能读回来。
