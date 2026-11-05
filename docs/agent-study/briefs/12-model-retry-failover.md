# Brief 12：模型调用重试 + 流中断恢复 + 可选降级模型（qling）
约束：同 Brief 07（只改本地工作区，分支 `codex/agent-reliability-v3`，HEAD ffdf824，不 commit、不 push；改前跑 `npm test` 记基线，改后 0 新增失败；`npx tsc --noEmit` 通过；`npm run eval:recovery`、`npm run eval:tasks` 前后对比不下降）。
**不得修改**用户未提交文件：`src/cli/startup-contract.ts`、`src/config.ts`、`src/index.ts`、`src/tui/streaming-repl.ts`、`tests/unit/goal-controller.test.mjs`、`tests/unit/opencli-skill-routing.test.mjs`。本 Brief 的设计**不需要**改 config.ts / index.ts（新开关全部走环境变量，退出码沿用 `index.ts:1441` 的 `failed → exitCode=1`）；唯一可选例外见任务 7。
安全不得放宽（不新增出站目标、不记录 key/Authorization、错误详情继续经 `sanitizeProviderDetail`）。不做真实付费调用，测试全部用假 provider / 本地 127.0.0.1 HTTP 桩。
**Pi 自身运行规则**：你自己的会话若遇到模型错误（gateway/upstream stream error、429、5xx 等），立即停下并询问用户，不要自行重试大段工作或"先交差"。
结果写到 `docs/agent-study/results/12-model-retry-RESULT.md`（改动文件清单、基线/改后测试数、eval 对比、未完成项）。

## 背景（真实事故）
Pi（经本地中继 Magpie :3425 调 grok-4.7）在一轮中连续 3 次 `grok gateway upstream stream error` 后退出，丢失 84 轮工作；另一次在最终总结时因模型错误退出。

## 现状（已核对 HEAD ffdf824）
- 调用层：`src/providers/llm-client.ts` `LlmHttpClient.chatCompletions`（axios；`stream` 时走 `streamChatCompletions` 解析 SSE）。错误统一为 `ProviderHttpError{status,code,retryAfterMs,requestId,retriable}`；`parseRetryAfterMs` 已支持秒数/HTTP 日期。
- **Bug A（事故根因）**：流中途断开（`llm-client.ts:258-266`）抛 `ProviderHttpError{status: 200, retriable:false, "stream ended before a valid completion"}`；`execution/failure-classifier.ts:39` 只看 status=429/≥500 或正则 → 归为 `provider_terminal` → 硬停（`recovery-controller.ts:40`）。即中途断流**从不重试**。
- **Bug B**：SSE 里的错误帧（`data: {"error":{...}}`，网关常这样报 upstream error）不会被识别，`choices` 为空 → 返回空 completion；流在没有 `[DONE]`/`finish_reason` 时自然 EOF 也被当成功。
- **Bug C**：classifier 忽略 `ProviderHttpError.retriable`；且 context-length 的 400 会因无 status 规则落到正则后段，顺序脆弱。
- 现有重试：`agent/main-loop.ts:1009-1035` 在**外层**对 `provider_transient` 重跑整个 `executeInner`，上限 `providerRetryLimit`（`agent-loop.ts:413`，env `QLING_LLM_MAX_RETRIES`，默认 3），退避 `min(4s, 250·2^n)+0~100ms`——总等待约 2s，扛不住网关抖动；耗尽后 `main-loop.ts:1036-1040` 返回 `failed` 并清 activeRun，**不 checkpoint**。
- 调用点：主循环 `main-loop.ts:500` `host.chat(systemPrompt)` → `agent-loop.ts:1919` `llmClient.chatCompletions`；assistant 消息在 `main-loop.ts:503` **完整返回后才** push，工具在其后执行 → 只要重试包在 `host.chat` 这一层，就天然不会重复执行工具、不会写入半截文本。另有压缩 summarizer `agent-loop.ts:1366`、`pipeline/verification.ts:84`。
- 持久化：`checkpointSession()`（`agent-loop.ts:1591`）；工具批次后节流 checkpoint（Brief 06，`main-loop.ts:380-387,684`）；中断检测 `session/interrupted-run`。
- 测试框架实际是 `node:test` 跑 `dist/`（`npm test` = build + `node --experimental-test-module-mocks --test tests/unit/**/*.test.mjs`），不是 vitest；新测试照 `tests/unit/main-loop.test.mjs`、`llm-client.test.mjs` 的写法。

## 参考（TS 重写，不拷贝）
- grok-build `crates/codegen/xai-grok-sampler/src/retry.rs`：`classify_error` → `Retry / RetryWithBackoff / RetryWithClientRebuild / Fatal / EmitToSession`；auth 错误不重试直接报给会话；context/token 溢出 `is_retry_vetoed` 快速失败；429 单独阈值 `RATE_LIMIT_RETRY_THRESHOLD`；`retry_backoff_with_jitter` = 2s 起翻倍、`MAX_RETRY_BACKOFF=30s`、±20% 抖动；`retry_after_or_backoff` 用 Retry-After（同样封顶 30s）；`DEFAULT_MAX_RETRIES=15` 可被 `GROK_MAX_RETRIES` 覆盖。`crates/common/xai-circuit-breaker/src/retry_policy.rs`：429+任意 5xx 可重试，其余 4xx 终止。
- Codex `codex-rs/model-provider-info/src/lib.rs:67-75`：`request_max_retries`=4、`stream_max_retries`=5（硬上限 100），分开计数；`codex-rs/codex-client/src/retry.rs:43` `backoff()` 指数 + 0.9–1.1 抖动，Retry-After 优先；`codex-rs/core/src/responses_retry.rs`：流错误时 `notify_stream_error("Reconnecting... n/max")` 让 UI 不像卡死，重试耗尽后才切备用传输且**不绕过服务端 Retry-After**；ContentFilter 不重试。
- Cline `src/core/api/retry.ts`（`withRetry`：maxRetries 3、baseDelay 1s、maxDelay 10s，读 `retry-after`/`x-ratelimit-reset`；PR #10140/#10384：Retry-After 过长（>60s/5min）立即抛出，避免静默挂几小时）。
- OpenHands software-agent-sdk `openhands-sdk/openhands/sdk/llm/llm.py:180,379-382`（`LLM_RETRY_EXCEPTIONS`=连接/502/429/503/超时/5xx/无响应；`num_retries=5, retry_min_wait=8, retry_max_wait=64, retry_multiplier=8`，litellm+tenacity）与 `llm/fallback_strategy.py`（**重试耗尽后**才按有序列表尝试备用 LLM，仅限 transient 错误）。

## 任务
1. **错误分类**（新文件 `src/providers/model-retry.ts`，纯函数）：`classifyModelError(err) → {kind, retryable, retryAfterMs?, status?, requestId?}`，kind ∈
   - 可重试：`network`（ECONNRESET/ETIMEDOUT/EAI_AGAIN/socket hang up/无 status 的 transport）、`rate_limited`（429）、`server`（500/502/503/504/529 及其他 5xx）、`stream_interrupted`（中途断流、SSE 错误帧、无 `[DONE]`/`finish_reason` 的 EOF、idle 超时）；
   - 不可重试：`auth`（401/403）、`bad_request`（400/404/422 等）、`context_length`（message/code 含 context_length_exceeded / maximum context / too many tokens，优先于 400 判定）、`content_policy`（content_filter / policy / safety）、`canceled`（AgentRunCanceledError / signal.aborted——永不重试）。
   - SSE 错误帧若带明确 4xx 语义（如 `invalid_request_error`、`authentication_error`）按对应不可重试类处理。
2. **llm-client 修正**（`src/providers/llm-client.ts`）：
   - 断流改为 `ProviderHttpError{status: undefined, code:"stream_interrupted", retriable:true}`，detail 记已收字节数/是否已有 tool_call 片段；
   - 解析到 `parsed.error` 帧 → 抛 `ProviderHttpError{code:"upstream_stream_error"| 上游 code, retriable: 按任务 1}`；
   - EOF 时既没 `[DONE]` 也没任何 `finish_reason` → `stream_interrupted`（兼容：收到过 finish_reason 即视为完整）；
   - 可选 idle watchdog：`QLING_LLM_STREAM_IDLE_MS`（默认 120000，0=关）两块之间无数据即 abort 并归为 `stream_interrupted`；
   - 返回值增加 `finishReason?`。不改非流式成功路径、不改请求头/鉴权。
3. **退避与预算**（`model-retry.ts`）：`computeBackoffMs(attempt, policy, retryAfterMs, rng)` = `min(cap, base·2^(attempt-1))` × 抖动[0.8,1.2]；有 Retry-After 时取 `max(retryAfter, 退避)`，但 Retry-After > `QLING_LLM_RETRY_AFTER_MAX_MS` 时**不等待**，视为本模型耗尽（可转 fallback，否则失败）。环境变量与默认值（未设置/非法值回落默认，且做上下限钳制）：
   | 变量 | 默认 | 钳制 |
   |---|---|---|
   | `QLING_LLM_MAX_RETRIES`（已有，语义改为**每次模型调用**的重试次数） | 5 | 0–20 |
   | `QLING_LLM_RETRY_BASE_MS` | 1000 | 100–10000 |
   | `QLING_LLM_RETRY_MAX_DELAY_MS` | 30000 | 1000–120000 |
   | `QLING_LLM_RETRY_AFTER_MAX_MS` | 60000 | ≤600000 |
   | `QLING_LLM_RETRY_MAX_ELAPSED_MS`（单次调用总等待墙钟） | 300000 | ≤1800000 |
   | `QLING_LLM_RUN_RETRY_BUDGET`（单个 run 内所有调用累计重试） | 20 | 0–200 |
   | `QLING_LLM_FALLBACK_MODELS`（逗号分隔，有序） | 空=关闭 | ≤3 个 |
   注意 `config.ts:274,541` 已把 `llm.max_retries` 默认 3 写进 `QLING_LLM_MAX_RETRIES`；不改 config.ts，因此实际默认仍是 3（来自 config），仅在 env 缺失时（SDK/测试直接构造 AgentLoop）用 5。在 RESULT 里写明这一点，建议用户在配置里把 `llm.max_retries` 调到 5。429 单独上限：`min(maxRetries, 4)`（参考 grok-build 的 rate-limit 阈值）。
4. **调用包装**：`callModelWithRetry({call(model, attempt), policy, models:[primary,...fallbacks], signal, sleep, now, rng, onEvent, runBudget})`。
   - 在 `agent-loop.ts` 的 chat 方法（`:1919`）内包住 `llmClient.chatCompletions`；同样包住 summarizer（`:1366`，重试上限 `min(maxRetries,2)`、无 fallback）。`pipeline/verification.ts:84` 可选，同 summarizer 策略。
   - 每次重试是**整次请求重发**，入参 `this.messages` 不变；半截文本与半截 tool_call 片段全部丢弃（本来就只在成功返回后由 `main-loop.ts:503` 写入）。禁止在流中途把任何 tool_call 交给执行器。
   - 重试前 emit `model_retry`（agent 事件）供 UI：`{attempt, max, delayMs, kind, status, model}`；已流出的部分文本无法撤回时，额外 emit 一次 `response_delta("\n[模型连接中断，已丢弃上段输出，第 n/max 次重试…]\n")`（**不改 streaming-repl.ts**）。`cli/acp-server.ts` 可订阅 `model_retry` 发一条说明 chunk（允许改）。
   - 每次重试前检查 `signal.aborted`（立即抛 cancel）、单调用墙钟、run 预算、以及现有成本预算（`cost-budget.ts` `resolveCostBudgetSignal(...).exhausted` 为真则不再重试）。sleep 必须可被 abort 打断。
   - 包装器抛出的最终错误带 `modelRetryExhausted: true, attempts, lastKind`。
5. **外层不重复重试**（`agent/main-loop.ts:1009-1041`）：错误带 `modelRetryExhausted` 时跳过外层 `transport_retry`（避免 3×6 次相乘）；外层旧逻辑保留给未经包装的路径。耗尽时：
   - **先 `await host.checkpointSession?.()`**（新增 OuterLoopHost 可选字段，agent-loop 传入；失败只告警），保留 messages 中所有已完成的工具结果；
   - 返回 `{status:"failed", failure, text}`，text 形如："模型调用失败：<kind>（<status/code>，request-id …），已重试 N 次 / 已尝试模型 [a,b]。会话已保存为 <sessionId>，已完成的工具结果均保留。恢复：`qling --resume <id>`（或 `!load <id>`）后发送"继续"。" 恢复命令以仓库实际为准，Pi 核对后填写；
   - 不可重试错误（auth/bad_request/context_length/content_policy）不重试、不 fallback，同样 checkpoint 并给出明确信息（context_length 提示 `/compact`）。
   - `failure-classifier.ts`：优先读 `ProviderHttpError.retriable` / `code`；`stream_interrupted|upstream_stream_error` → `provider_transient`；context_length 判定提前到 status 规则之前。
6. **Fallback 模型**（默认关闭）：仅当主模型因**可重试**错误耗尽（含 Retry-After 过长）时，按 `QLING_LLM_FALLBACK_MODELS` 顺序切换，每个备用模型独享一份 `maxRetries`（但共享 run 预算）；只换 `model` 字段，**同 endpoint、同 key、同 provider**（不引入新出站目标，安全不放宽）。切换时 emit `model_fallback{from,to,reason}`，并经 `response_delta`/`repair` 事件向用户显示"已切换到备用模型 X"，写入 run trace。切换在当前 run 内保持粘性；下一次用户输入回到主模型。不可重试错误不触发 fallback。
7. **（可选，需用户同意）** 若用户希望在配置文件里写 `llm.fallback_models`，需改 `src/config.ts` 一处最小 hunk：`QlingConfig.llm` 增 `fallback_models?: string[]`，`applyConfigToProcessEnv`（`:541` 后）增一行写 `QLING_LLM_FALLBACK_MODELS`。默认**不做**；若做，在 RESULT 中单列 diff。`src/index.ts` 不需要改。
8. **遥测**：经 `executionEventBus.emit`（必要时扩展 `execution/types.ts` 事件类型与 `otel-trace.ts` 映射）记录 `model_retry_scheduled{attempt,max,delayMs,kind,status,requestId,model}`、`model_retry_recovered{attempts,elapsedMs}`、`model_fallback_activated{from,to}`、`model_retry_exhausted{attempts,elapsedMs,lastKind,models}`；`retryCountTotal`/`logTurnTelemetry` 的 retries 计入调用级重试。日志不得含 key、Authorization 或完整请求体。

## 测试（tests/unit/model-retry*.test.mjs，node:test，零真实 API）
- **纯函数**：分类表（ECONNRESET、429+Retry-After、500/502/503/529、stream_interrupted、upstream 错误帧、401、403、400、context_length、content_policy、cancel）；退避用注入 rng 断言精确值与 cap；Retry-After 秒/日期两种；Retry-After 超上限 → 不等待直接耗尽；env 非法值回落与钳制。
- **llm-client（127.0.0.1:0 本地 HTTP 桩）**：SSE 发两块后 `socket.destroy()` → `stream_interrupted` retriable；`data: {"error":{"message":"grok gateway upstream stream error"}}` → retriable；无 `[DONE]` 无 finish_reason 的 EOF → interrupted；有 finish_reason 无 `[DONE]` → 成功；429 带 `Retry-After: 2`；401 不重试。
- **包装器**（注入 fake `call` + 假 `sleep`/`now`，不真等）：429→429→成功；连续 3 次 upstream stream error 后成功（复现事故，必须成功）；401 只调 1 次；超 run 预算停止；abort 在 sleep 中立即返回 cancel；fallback 顺序 `[primary×(n+1), fb1×(n+1), fb2 成功]`，并收到 `model_fallback` 事件；未配置 fallback 时绝不换模型；不可重试错误不 fallback。
- **AgentLoop 端到端**（fake LlmHttpClient 脚本 + 计数型 fake 工具）：第 1 次调用返回 tool_call → 工具执行 1 次；第 2 次调用流中断 2 次后成功 → 工具执行计数仍为 1、messages 中无半截 assistant、无重复 tool 消息；外层不再叠加重试（总调用数 = 预期）。
- **耗尽可恢复**：持续 503 → outcome `failed`，text 含 sessionId 与恢复指引；会话文件存在且含已完成工具结果；新 AgentLoop `restoreSession` 后脚本改为成功 → 继续完成，工具不重复执行；interrupted-run 不误报/重复提醒。
- 回归：既有 `llm-client.test.mjs`、`main-loop.test.mjs`、`agent-loop-streaming.test.mjs` 全绿（如断言了旧的 "status 200 retriable:false" 行为，更新断言并在 RESULT 说明）。

## 验收标准
1. 模拟事故（连续 3 次 upstream stream error 后恢复）不再退出，工作不丢；
2. 任意重试路径下工具执行次数不增加，messages 中无半截 assistant 文本；
3. 重试有上限（单调用次数、单调用墙钟、run 预算、成本预算），不会无限循环；
4. 耗尽或不可重试错误时：会话已 checkpoint、输出明确原因与恢复方法、非零退出（沿用现有 failed 路径），无静默丢失；
5. fallback 默认关闭；启用时按序、用户可见、有遥测；
6. `npx tsc --noEmit` 通过，`npm test` 0 失败（对比基线），`eval:recovery`/`eval:tasks` 不下降；未触碰受保护文件（`git diff --stat` 附在 RESULT）。

## 度量
人工：用本地桩（或可控中继）注入 30% 断流率跑一个 20 轮任务，记录完成率、总重试次数、额外 token 与墙钟；对比改前。
