# 12 model-retry-failover RESULT

- 分支 codex/agent-reliability-v3，HEAD ffdf824。快照两份：C:\Users\Lenovo\qling-agent-study\r4\pre12 和 %TEMP%\qling-agent-study\r4\pre12，各 82 个文件。
- Pi：magpie/codex-router/grok-oauth/grok-4.7，会话 qling-r4-12。
  - 第 1 次（10/15）：网关报 "The Grok gateway could not complete the upstream response stream." 共 3 次后退出。留下 9 个文件的改动，其中 model-retry.ts 有 TS2366 编译错误，测试一个都没写。
  - 第 2 次（10/16，用户已确认）：同会话续做。修好编译错误，补齐任务 1–6 和测试，正常结束（stopReason=stop），没有模型报错。

## 改动文件（与 pre12 比对）
新文件：src/providers/model-retry.ts、tests/unit/model-retry.test.mjs、tests/unit/model-retry-llm.test.mjs、tests/unit/model-retry-agent.test.mjs
修改：src/providers/llm-client.ts、src/agent-loop.ts、src/agent/main-loop.ts、src/cli/acp-server.ts、src/execution/failure-classifier.ts、src/execution/otel-trace.ts、src/execution/types.ts、src/pipeline/verification.ts
混改文件：**无**。上面这些文件在 pre12 时都没有未提交改动。用户未提交的 82 个文件（含 brief 点名受保护的 config.ts、index.ts、startup-contract.ts、streaming-repl.ts、goal-controller.test.mjs、opencli-skill-routing.test.mjs）哈希比对全部一致。没有动 package*.json，没有加依赖。

## 测试 / eval
| | 改动前 | 改动后 |
|---|---|---|
| tsc --noEmit | 通过 | 通过 |
| npm test | 1459 个，1458 通过，0 失败，1 跳过 | 1483 个，1482 通过，0 失败，1 跳过（+24 个新用例） |
| eval:recovery | ok，15 fixtures | ok，15 fixtures |
| eval:tasks | 11/11 | 11/11 |
两个 eval 都是本地确定性评测（model: none），不调用付费模型。dist/ 已重新生成。仓库根目录干净：git status 与 pre12 相比只多出上面列的文件。
既有测试里没有断言 "status 200 / retriable:false" 的，所以没改旧断言。

## 实现要点（来自 Pi 的汇报，协调者做了只读核对）
- model-retry.ts：错误分类（network/rate_limited/server/stream_interrupted 可重试；auth/bad_request/context_length/content_policy/canceled 不可重试）；退避带 0.8–1.2 抖动；Retry-After 超过上限时不等待，直接判本模型耗尽；env 值钳制；callModelWithRetry 实现 run 预算、单次调用墙钟、成本预算、可被 abort 打断的 sleep、fallback。
- llm-client.ts：流中途断开、SSE 错误帧、既无 [DONE] 也无 finish_reason 就 EOF，都归为 stream_interrupted（retriable）；加了 idle watchdog（QLING_LLM_STREAM_IDLE_MS）；返回值带 finishReason。
- main-loop.ts：错误带 modelRetryExhausted 时不再叠加外层重试；耗尽或遇到不可重试错误时先 checkpointSession，再返回 failed，文案里带恢复指引。
- 恢复命令（Pi 核对过仓库）：`qling --resume <id>`、`!load <id>`、`/resume <id>`。
- failure-classifier 优先读 retriable/code；context_length 的判定提前到 status 规则之前。
- 遥测：model_retry_scheduled/recovered、model_fallback_activated、model_retry_exhausted 已接入 otel-trace。
- 测试覆盖：分类表；退避精确值；本地桩上的断流、错误帧、EOF、429、401、idle；事故场景（连续 3 次 upstream error 后恢复）；fallback 顺序；不可重试错误不 fallback；AgentLoop 端到端验证工具不重复执行、没有半截 assistant；503 耗尽后 restoreSession 可以继续。

## 安全审查（只读）
- fallback 只换 model id，endpoint/key/provider 不变（model-retry.ts 文件头注释也写明了），没有新增出站目标。
- Authorization 只在 llm-client 原有的请求头构造处出现；新代码不记录 key 或请求头。
- 测试只用 127.0.0.1 本地桩和假 key。
- 安全没有放宽。

## 偏离 / 未完成
- 任务 7（config.ts）按要求没做。所以 CLI 下实际默认重试次数仍是 3（来自 config 的 llm.max_retries）；只有 env 缺失时（SDK/测试直接构造 AgentLoop）才是 5。**建议把配置里的 llm.max_retries 调到 5。**
- brief「度量」一节要求的人工测量（30% 断流、20 轮任务）没有做。
- 第 1 次运行因模型错误中断，见上。
