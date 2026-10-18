# 11 tail-fixes RESULT

- 分支 codex/agent-reliability-v3，HEAD db232b5；快照 %TEMP%\qling-agent-study\r4\pre11
- 实现：Pi，模型 magpie/codex-router/grok-oauth/grok-4.7，会话 qling-r4-11（第 2 次尝试，2026-10-13 18:02 UTC+8 起）
- 运行情况：Pi 在 18:15 左右停止写日志，进程消失、未写 .done、也没有最终 stopReason（期间 PC 多次掉线）。代码在 18:06–18:10 已落盘，1–4 条全部有改动。按指令未重试，由协调者跑 tsc + npm test 并做只读审查。

## 改动文件（和 pre11 快照对比）
| 文件 | 条目 | 是否混改（用户原来就有未提交改动） |
|---|---|---|
| src/guard/workspace-trust.ts | 1 | 否（新加改动） |
| tests/unit/workspace-trust.test.mjs | 1 | 否 |
| src/hooks/json-hooks.ts | 2 | 否 |
| tests/unit/json-hooks-policy.test.mjs | 2 | 否 |
| src/mission/manager.ts | 3 | 否 |
| tests/unit/mission-manager.test.mjs | 3 | 否 |
| src/tools/verify.ts | 4 | **是**（原本就是用户未提交的修改） |
| tests/unit/verify-tool.test.mjs | 4 | **是**（用户未跟踪的文件） |
注：前 6 个文件在 r3 期间已是工作区修改文件（来自 07–10），本份仅在其上追加改动。没有改到其他文件，也没有新文件。

## 各条说明
1. 信任判断：normalizeTrustPath 先做 realpathSync.native；路径不存在时，对最近的已存在祖先取 realpath，再拼回缺失后缀；遇到非 ENOENT 的错误时回退 path.resolve。Windows 下仍不区分大小写。新测试 `trust follows real paths and ignores a junction that points outside`：Windows 下用 junction，**实际执行了，没有 skip**。
2. matcher 改为整串匹配：编译成 `^(?:matcher)$`。兼容性变化：以前 `Edit` 也会匹配 MultiEdit，现在不匹配了；要沿用子串匹配，需要写成 `.*Edit.*`。编译失败时仍然 fail-closed（PreToolUse 判 ask，observe-only 事件则禁用该条）。新测试 `tool matcher matches the whole name, alternation, and still fails closed`。
3. 没有 ownerPid 或 owner 已死的 running mission，状态改为 **paused**（沿用已有状态，resumeMission 能直接接受），reason 仍是 interrupted_on_restart；不会自动 resume。测试改成断言 paused，并新增 legacy/owner 存活的用例。
4. verify tail：测试改用脚本文件 `node print-lines.mjs`，命令文本里不再出现 'one'；实现在 head/tail 视图里过滤 `^npm notice` 行，完整产物仍保留原始输出。新增断言：视图里没有 npm notice；artifact 里含 one/two/three。原断言 doesNotMatch(/one/) 保留，没有 skip。

## 验收
- tsc --noEmit：exit 0
- npm test：tests 1456 / pass 1455 / fail 0 / skipped 1（基线：1453 / 1451 / 1 失败 / 1 跳过）
- 根目录：没有 sessions/、nul，相比 pre11 没有新增未跟踪文件

## 只读安全审查 / 偏离
- 第 2 条按 brief 要求收窄了匹配范围。已有配置如果写的是 `Edit`，原本想同时拦 MultiEdit 的话，PreToolUse 现在不会再对 MultiEdit 触发，这对旧配置算是一处**有意的行为变化（某种意义上的放宽）**，需要用户知悉。fail-closed 逻辑没有变。
- 第 1 条：realpath 遇到非 ENOENT 错误（比如 EACCES）时回退成 resolve（brief 允许回退），这种情况下按链接本身的路径判断。属边缘情况。
- 第 4 条：视图过滤 npm notice 属于对实现的小改动；full 模式视图现在会去掉末尾换行（artifact 不受影响）。verify.ts 是混改文件。
- 第 3 条：用了现有的 paused 状态，没有新增状态。
- Pi 没有正常结束，最后的自检没有被确认，以上验收都由协调者完成。
- 第 5 条 Magpie：本轮开始时已核对过：Startup\Magpie.lnk 存在，目标是 YetoneMagpie\magpie.exe；18:02 时 3425 处于 LISTENING（PID 40924）。没有重复创建。

## 补充项 11b：matcher 别名表 + 兼容性警告（2026-10-15）
- 快照：原来的 %TEMP%\qling-agent-study\r4\pre11b 已被 Windows 临时目录清理掉（目录还在，文件全没了），10/13 那次 Pi 的日志也一起丢了。不过两个目标文件的修改时间仍停在 10/13 18:10，说明那次 Pi 没写进任何改动。10/15 17:36 重新拍了快照，放到非 TEMP 目录 C:\Users\Lenovo\qling-agent-study\r4\pre11b，工作目录也一并迁到那里。
- Pi：magpie/codex-router/grok-oauth/grok-4.7，会话 qling-r4-11，命令末尾加了 `< NUL`。17:39 代码改完，Pi 自己跑的 tsc 和相关测试都通过了。最后一轮写总结时出现模型错误 "The model stopped producing output before the router's stream deadline."，没有重试。tsc、npm test 和只读审查由协调者完成。
- 别名核对：patch（src/tools/patch.ts）、read（src/tools/read.ts）、patch_anchored 和 read_anchored（src/tools/anchored-edit.ts）这四个工具名都存在。
- 改动文件：只有 src/hooks/json-hooks.ts 和 tests/unit/json-hooks-policy.test.mjs（和 pre11b 逐文件比对哈希确认）。这两个文件都是前几轮 brief 改出来的工作区修改，不涉及用户自己的改动。
- 实现：
  1. 整名匹配 `^(?:m)$` 不变。加了别名表 TOOL_MATCH_ALIASES：工具名是 patch_anchored 时，如果 matcher 能整名匹配 "patch" 也算命中；read_anchored 对应 read。这个方向是单向的，"patch_anchored" 不会反过来命中 patch。因为别名是在整条正则上检查，所以 `patch|write` 这类多选写法同样生效。编译失败或拿不到工具名时，仍然 fail-closed（返回 ask）。
  2. noteMatcherRegression：如果某条 matcher 按旧的子串规则能命中某个已注册工具，按新规则（含别名）却命中不了，就 console.warn 一次。每条 matcher 字符串只警告一次（用模块级 Set 去重），测试可以用 resetJsonHookMatcherWarningsForTests 重置。警告不影响判定。
  3. 注释里的 Edit/MultiEdit 例子换成了 patch / patch_anchored / `.*patch.*`。
- 新测试：`patch and read matchers also match anchored aliases but not unrelated names`、`matcher compatibility warning fires once only when a substring hit is lost`。
- 验收：tsc --noEmit 退出码 0；npm test 共 1458，通过 1457，失败 0，跳过 1；仓库根目录干净（git status 和 pre11b 完全一致）。
- 安全审查：别名只会让 PreToolUse 多命中 *_anchored 工具，所以只会更严；fail-closed 逻辑没改。
- 偏离：警告依赖 JsonHookRunner 的可选参数 knownToolNames 传入已注册工具名，而生产里唯一的构造点（json-hooks.ts:832）没有传。这个文件里拿不到工具注册表，接线得改其他文件，超出了只改两个文件的范围。所以**现在生产环境不会触发这个警告**，只在测试或显式传入时生效。要让它在生产生效，需要另外授权去改调用方。另外，测试里原有的 Edit/MultiEdit 整名匹配断言保留了（那是合成的工具名，用来锁住整名匹配的语义）。

## 补充项 11c：一次性警告接入运行时（2026-10-15）
- 快照：C:\Users\Lenovo\qling-agent-study\r4\pre11c
- Pi：magpie/codex-router/grok-oauth/grok-4.7，会话 qling-r4-11c，命令末尾加 `< NUL`。正常结束（stopReason=stop），没有模型报错。
- 改动文件（逐个文件与 pre11c 比对哈希）：
  - src/hooks/json-hooks.ts：installJsonHooks 新增可选参数 `knownToolNames?: readonly string[]`，原样传给 new JsonHookRunner。
  - src/agent-loop.ts：installJsonHooks 调用处只加了一行 `knownToolNames: this.config.tools.map((tool) => tool.name)`。子 agent 走同一路径，传的是它自己筛过的工具列表。
  - tests/unit/json-hooks-policy.test.mjs：新测试 `installJsonHooks warns once per regressed matcher and does not change decisions`。测试走 installJsonHooks，env 和 manifest 都用临时目录。断言每条 matcher 只警告 1 次，并且传不传 knownToolNames 判定结果都一样。
- 混改文件：无。src/agent-loop.ts 在 pre11c 时没有未提交改动，是这次才新改的。另外两个文件是前几轮 brief 的工作区改动。
- 验收：
  - tsc --noEmit：exit 0。
  - npm test：第一次 1459 个用例，1457 通过，1 失败，1 跳过。失败的是 `repl slash loop runs due task from local scheduler timer`，原因是 Windows 临时文件 rename 报 EPERM，这是之前记录过的环境性 flaky，和本次改动无关。重跑一次全量：1459 个用例，1458 通过，0 失败，1 跳过。
  - 根目录干净：git status 与 pre11c 相比只多了 `M src/agent-loop.ts`。
- 只读审查：警告只调用 console.warn，不参与 allow/ask/deny 判定；fail-closed 的行为没有变化。安全没有放宽。
- 偏离：无。
