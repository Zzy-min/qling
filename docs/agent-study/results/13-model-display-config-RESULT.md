# 13 model-display-config RESULT

- 分支 codex/agent-reliability-v3（HEAD ffdf824，工作区已含 brief 12 的改动）。
- 快照：C:\Users\Lenovo\qling-agent-study\r4\pre13，96 个文件。
- Pi：magpie/codex-router/grok-oauth/grok-4.7，会话 qling-r4-13。
  - 第 1 次：网关报 "The Grok gateway could not complete the upstream response stream."，代码大部分已落盘，留下 1 条新测试失败。
  - 第 2 次（用户确认后续做）：修好了这条失败测试（只改 src/providers/resolve-llm.ts），随后最后一轮又报模型错误 "The model stopped producing output before the router's stream deadline."，没能给出逐项总结。按规则没有重试。
  - 下面的逐项完成情况由协调者只读审查得出。

## 测试 / 评测
| | 改动前（pre13） | 改动后 |
|---|---|---|
| tsc --noEmit | 通过 | 通过 |
| npm test | 1483 个，1481 通过，1 失败，1 跳过 | 1505 个，1504 通过，**0 失败**，1 跳过（+22 个用例） |
| eval:recovery | ok，15（brief 12 收尾时测得） | ok，15 |
| eval:tasks | 11/11 | 11/11 |

- 基线那 1 条失败是已知的偶发问题 `repl slash loop runs due task from local scheduler timer`（Windows EPERM），改动后没有出现。
- 两个评测都是本地确定性评测，不调用模型。
- 仓库根目录干净：相对 pre13 新增的未跟踪文件只有 src/providers/remote-models.ts、src/providers/resolve-llm.ts、tests/unit/provider-key-resolution.test.mjs。

## 改动文件（相对 pre13）
- 新文件：src/providers/resolve-llm.ts、src/providers/remote-models.ts、tests/unit/provider-key-resolution.test.mjs
- 修改：
  - src：cli/bootstrap.ts、commands/claude-style.ts、commands/config.ts、context-report.ts、eval/llm-tasks.ts、help-topics.ts、providers/presets.ts、sdk.ts、session/compact-auto.ts、session/goal-evaluator.ts、statusline.ts、tools/vision-analyze.ts、agent-loop.ts\*、providers/llm-client.ts\*
  - 文档：README.md、docs/install.md、docs/sdk.md
  - 测试：tests/unit/{compact-auto,config,context-budget,llm-client,model-command,statusline}.test.mjs
- \* agent-loop.ts 和 llm-client.ts 之前的未提交改动来自 brief 12，不属于用户自己的改动。

## 混改文件（用户自己有未提交改动的文件）：brief 13 改的 hunk
行号是改动后文件的新行号，用 `git diff --no-index pre13\files\<f> <f>` 可以复现。逐行核对过：被删的行都是 HEAD 原有的代码，用户自己的改动没有被删。

- **src/config.ts**（只有新增）
  - +6–10：import alignLoadedLlmConfig 及相关类型
  - +265：LoadedConfig.llmSources
  - +268–269：export type
  - +517–518：detectLlmSources、alignLoadedLlmConfig 调用
  - +524–571：返回 llmSources，新增 llmFieldDefined、detectLlmFieldSource、detectLlmSources
- **src/index.ts**
  - @@-420,5 +420,2：needSetup 改为 hasAnyConfiguredApiKey(process.env)，替换原来的三段 key 回退
  - @@-810 +807,8：formatLocalConfigReport 增加 sources 参数；新增 `models` 模式分支（runModelsCli）
  - @@-1093,6 +1097,5：agentConfig.apiKey 不再回退到 DEEPSEEK/OPENAI 的 key，并传入 llmSources
- **src/cli/startup-contract.ts**
  - @@-7 +7、@@-9,2 +9,2：CliMode、KNOWN_MODES、MANAGEMENT_MODES 增加 "models"
  - +48：别名 "模型"
  - +706：帮助里增加 `models` 一行
- **src/config-report.ts**
  - @@-1 +1：import 增加 LlmFieldSources
  - @@-137 +137,7：formatLocalConfigReport 增加可选参数 sources，生成 Source 行（只输出来源标签，不含 key）
  - +152：输出 Source 行
- **src/tools/subtask.ts**
  - +19：import resolveActiveLlm
  - @@-132,5 +133,2 和 @@-143,7 +141,3：原来的 key/provider/endpoint/model 回退链改为 resolveActiveLlm(process.env)
- **src/tui/streaming-repl.ts**（只有新增）
  - +229–235 前后：订阅 model_retry、model_fallback 事件，触发 refreshStatusLine

## 逐项完成情况（只读审查）
1. **P0 Key 不串用：完成。**
   - resolve-llm.ts 里的 resolveProviderApiKey 按 provider 取对应的 `<PROVIDER>_API_KEY`；QLING_LLM_API_KEY 只有在 provider 和启动时相同时才会用。
   - claude-style.ts:153 的 applyPreset 在缺 key 时拒绝切换，提示里给出对应变量（例如 MOONSHOT_API_KEY）。
   - agent-loop.ts:1285 起：provider 变化时用 resolveSessionApiKey 重新解析 key，不保留旧 key。
   - 测试 provider-key-resolution.test.mjs 用 mock 断言 Authorization 头。
2. **P0 统一 resolveLlmSettings + 来源：完成。**
   - resolve-llm.ts 提供 resolveLlmSettings / resolveActiveLlm，并标注来源（default/file/env/cli/preset/session）。
   - agent-loop、vision-analyze、goal-evaluator、eval/llm-tasks、subtask 都已改用；index.ts 改用 hasAnyConfiguredApiKey，并去掉了 key 回退。
   - 在 src 里 grep `DEEPSEEK_API_KEY ??` / `||`，0 处。
3. **P1 provider 补齐 + 冲突告警：完成。**
   - config.ts 调用 alignLoadedLlmConfig：只给 provider 时按预设补齐 endpoint/model；冲突或未知 provider 写入 warnings。
   - endpoint 非 http(s) 时告警。
4. **P1 上下文窗口：完成。**
   - presets.ts 增加 contextWindow，并加了已知模型窗口表。
   - compact-auto.ts:43 在 window_tokens=0 时用模型窗口；/context 标注 source=window/model/legacy。
   - /model 切换后重算预算：agent-loop 已接入，有测试覆盖。
5. **P1 显示：基本完成。**
   - 状态栏显示 `provider·model`，窄屏只显示 model（statusline.ts:161）；有重试/降级的临时标记。
   - streaming-repl 订阅 model_retry、model_fallback，复用 brief 12 的事件，没改 brief 12 的逻辑。
   - /config 读 agent.getProvider/getEndpoint/getLlmFieldSources 和来源。
   - picker 用 activePresetIds 选中第一项，高亮唯一。
   - 未单独核实 `/model status` 是否也显示每个字段的来源。
6. **P2 校验与错误：完成。**
   - 模型名拒绝空白和带空格的名字；endpoint 必须是 http(s)。
   - llm-client 错误信息带 model= 和 endpoint=host（不含 key）；401/403 提示"key 无效或不属于 <provider>"，404 提示"模型名可能不存在，用 /model list --remote 查看"。
7. **P2 远端模型列表：完成。**
   - remote-models.ts 的 listRemoteModels 调 GET {endpoint}/models，失败时回退到预设。
   - 入口有两个：`/model list --remote`（claude-style.ts:269）和 `qling models`（index.ts、startup-contract）。
   - 测试用 127.0.0.1 mock。
8. **P3 文档：完成。**
   - README 写明了优先级、只给 provider 时的补齐规则，以及每个 provider 对应的 key 变量表。
   - docs/install.md、docs/sdk.md 已更新。

## 安全审查
- 跨 provider 不会再带旧 key（拒绝切换，或改取对应 provider 自己的 key）。
- 来源输出只有标签；endpoint 只显示 host；错误信息不含 key。
- 远端模型列表只请求当前 endpoint，没有新增出站目标。
- 安全没有放宽。

## 未完成 / 偏离
- Pi 两次都在最后一轮因模型错误结束，没有自评总结；以上结论来自协调者审查。
- `/model status` 每个字段的来源显示未单独核实（/config 已确认）。
- brief「度量」里的手工三方切换实测（DeepSeek→Kimi→Ollama 并带 --inspect-request）没做（需要真实 key，按约束不做）。
- 改动触及 6 个用户自己有未提交改动的文件（见上面的 hunk 清单），都是最小增量，没有删除用户的内容。
