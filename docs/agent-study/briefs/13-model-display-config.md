# Brief 13：模型配置一致性 + 显示真实生效模型 + 切换安全（qling）
约束：只在本地改；不 commit / 不 push；改前后各跑一次 `npm test`（全量单测）并对比通过/失败数；不得碰工作区已有的未提交改动。Brief 12（模型重试）尚待验证——本 brief 不改 llm-client 重试逻辑，只读它的事件。
基线：`codex/agent-reliability-v3` @ ffdf824（分析基于 GitHub 只读克隆，本地 PC 当时不可达；动手前先在本地 checkout 核对行号）。
参考思路：Codex CLI `~/.codex/config.toml` 的 `model` + `model_provider` + `[model_providers.<id>]`（每个 provider 自带 `base_url` / `env_key`，key 按 provider 绑定）与 `/model` 切换器、状态栏显示 model；OpenCode 用 `provider/model` 一个字符串表示、`opencode models` 列出可用模型、按 provider 存凭据（https://github.com/openai/codex/blob/main/docs/config.md ，https://opencode.ai/docs/models/ ）。

## 现状（file:line）
- 预设单一真相源：`src/providers/presets.ts:22-143`（10 个预设 + `local` 别名），无 context window / 能力元数据；`resolveModelCandidates()` :172 只是预设默认模型去重。
- 默认值：`src/config.ts:263-270` deepseek / deepseek-chat / api.deepseek.com，`context.window_tokens: 0`（:282）。
- 优先级：默认 < 配置文件（仅 cwd 下 `qling.config.{yaml,yml,json}` 或 `--config`，:742-752）< `QLING_LLM_*` 环境变量（:773 `buildEnvConfig` 按扁平路径自动映射）< CLI `--model/--provider/--endpoint/--api-key`（:961-964）。随后 `applyConfigToProcessEnv` 把结果写回 `process.env`（:529-536），之后各组件**再从 process.env 读**。
- 回退链分散：`src/index.ts:1089-1093`、`src/agent-loop.ts:349-366`、`src/tools/subtask.ts:123-138`、`src/tools/vision-analyze.ts:84-86`、`src/session/goal-evaluator.ts:53-61`、`src/eval/llm-tasks.ts:12-33` 各自写一遍 `QLING_LLM_API_KEY ?? DEEPSEEK_API_KEY ?? OPENAI_API_KEY` 与 `"deepseek"/"deepseek-chat"/"gpt-4o"` 默认。
- 切换：`/model`（`src/commands/claude-style.ts:103-243`）：无参/list → 选择器；`status`；`use <preset>`；`/model <任意串>` 仅改 model。底层 `AgentLoop.applyLlmSession`（`src/agent-loop.ts:1210-1260`）。
- 显示：状态栏 `src/statusline.ts:160,233` 只显示 `模型=<model>`；TUI 头部 `src/tui/streaming-repl.ts:63,143,418` 用 `agent.getModel()`；`/config`（`src/commands/config.ts:12-14`）读 process.env；`config-report.ts:94-96` / `doctor.ts:197-206` 对 key 已做 `set(redacted)`。
- 上下文窗口：`src/session/compact-auto.ts:31-43` → `context-budget.ts:19-31`，`window_tokens=0` 时退回 legacy 6000 token 触发压缩，与模型无关。
- 错误：`src/providers/llm-client.ts:62-63,342-358` 报 `"<provider> HTTP <status> error: <detail>"`，不带 model/endpoint；`agent-loop.ts:128` 缺 key 的提示固定提 DeepSeek/OpenAI。
- 测试：`tests/unit/model-command.test.mjs`（5 个）、`provider-presets.test.mjs`（4 个）、`config.test.mjs`、`config-report.test.mjs`、`statusline.test.mjs`。

## 问题（按严重度）
1. **切换供应商会把旧 key 发给新供应商**：`applyPreset` 对需要 key 的预设传 `apiKey: undefined`（claude-style.ts:135-141），`applyLlmSession` 走 else 分支保留原 key（agent-loop.ts:1241-1248）。DeepSeek key 用户 `/model use kimi` 后，DeepSeek 的 key 会被带着 Bearer 发到 api.moonshot.cn——401 且凭据外泄给第三方。切换后也没有提示"该预设需要另一个 key"。
2. **key 回退不分 provider**：`DEEPSEEK_API_KEY ?? OPENAI_API_KEY` 在 6 处无条件回退；provider=openai 时也可能拿 DeepSeek key。
3. **`--provider`/`QLING_LLM_PROVIDER` 不带出 endpoint/model**：只设 `--provider openai` 时 endpoint 仍是 api.deepseek.com、model 仍是 deepseek-chat（config.ts:961-963 逐字段覆盖）——显示 "openai · deepseek-chat" 且请求打到 DeepSeek。没有一致性校验或警告。
4. **上下文窗口与模型脱钩**：默认 6000 token 就压缩（128K 模型过早压缩），换到 `moonshot-v1-8k` 也不收紧；`/model` 切换后重建 compactor 但窗口不变（agent-loop.ts:1223-1229）。
5. **显示不完整/可能误导**：状态栏只有 model，不显示 provider/endpoint 主机；选择器 `active` 用 `model===current || provider===current`（claude-style.ts:170），mimo 与 mimo-token-plan 同时高亮、任意 deepseek 自定义模型都高亮 deepseek；`/config` 读 process.env 而非 AgentLoop 实际态；流式降级（`onStreamFallback`）和重试不在状态栏体现。
6. **无校验**：`/model <name>` 接受任意字符串（含空格/拼写错误），首次请求才 404；endpoint 不校验 URL；`llm.provider` 任意字符串；错误信息不含 model，用户难判断是 model 名错还是 key 错。
7. **无法列出可用模型**：`候选模型` 只是预设默认值，不调用 OpenAI 兼容的 `GET /models`。
8. **配置来源不可见**：用户看不出某值来自默认/文件/env/CLI/会话切换；会话切换不落盘这一点只在 `/model <name>` 时说明。

## 改动（按价值排序）
1. **P0 修 key 串用**：`applyPreset` 切到不同 provider 时，按 provider 解析 key（新 `resolveProviderApiKey(provider, env)`：`QLING_LLM_API_KEY`（仅当与启动 provider 相同时）→ `<PROVIDER>_API_KEY`（DEEPSEEK/OPENAI/DASHSCOPE/MOONSHOT/ZHIPU/MINIMAX/MIMO/SILICONFLOW）→ 无则拒绝切换并提示 `需要 <keyHint>：设置 <ENV> 或 /model use <id> 后 /login`）；同 provider 切换才沿用旧 key。`applyLlmSession` 在 provider 变化且未显式给 apiKey 时清空旧 key 而不是保留。
2. **P0 收敛回退链**：新 `src/providers/resolve-llm.ts` 导出 `resolveLlmSettings(config, env)`（provider/endpoint/model/apiKey + 每字段 `source`），index.ts / agent-loop / subtask / vision / goal-evaluator / eval 全部改用，删除散落默认值。
3. **P1 provider 一致性**：只给 provider（CLI 或 env）且 endpoint/model 来自默认值时，用该 provider 预设补齐 endpoint/model；显式冲突（provider=openai 而 endpoint 是 deepseek 主机）给出 warning（进 `LoadedConfig.warnings`）。
4. **P1 模型元数据**：`ProviderPreset` 增加 `contextWindow`（及可选 `maxOutputTokens`），另加 `KNOWN_MODEL_WINDOWS` 小表（deepseek-chat 64K/128K 按官方、gpt-4o 128K、moonshot-v1-8k 8K…，未知则 null）。`window_tokens=0` 时用模型窗口；`applyLlmSession` 换模型后重算预算。无元数据仍走 legacy 6000 并在 `/context` 标注 `source=legacy`。
5. **P1 显示真实生效态**：状态栏 `provider·model`（窄屏只显示 model）；`/config` 和 `/model status` 改读 `agent.getProvider/getModel/getEndpoint` + 每字段来源（default/file/env/cli/session）；endpoint 只显示 host；选择器 active 改为 `provider+endpoint+model` 全匹配。流式降级/重试时状态栏短暂显示 `↻ retry n/N` / `stream→non-stream`（读 Brief 12 已有事件，不改其逻辑）。
6. **P2 校验与错误**：`/model <name>` 拒绝空白/含空格名；endpoint 必须是 http(s) URL；未知 provider 警告。ProviderHttpError 消息补 `model=… endpoint=host`；401/403 → "key 无效或不属于 <provider>"，404 + model → "模型名可能不存在，用 /model list --remote 查看"。
7. **P2 列出远端模型**：`/model list --remote`（及 `qling models`）调用 `GET {endpoint}/models`（超时 5s，失败降级为预设列表），结果可在选择器里选；不缓存 key，不打印 key。
8. **P3 文档**：README/config 文档写明优先级与每 provider 的 key 环境变量。

## 验收
- DeepSeek key 会话 `/model use kimi`，未设置 MOONSHOT_API_KEY → 切换被拒且提示所需变量；**不会**向 moonshot 发出带 DeepSeek key 的请求（mock HTTP 断言 Authorization）。设置后切换成功。
- `qling --provider openai` 无其他参数 → endpoint=api.openai.com/v1、model=gpt-4o；`--provider openai --endpoint https://api.deepseek.com` → 有 warning。
- `/model use kimi`（8K）后压缩触发阈值 ≈ 8K×ratio；deepseek-chat 不再在 6000 token 就压缩。
- 状态栏/`/config`/`/model status` 三处显示一致且等于实际请求所用值；任何输出中不出现 key 明文。
- 选择器中同时高亮项 ≤ 1。
- 全量 `npm test` 通过数 ≥ 基线，无新增失败。

## 测试（新增）
- `provider-key-resolution.test.mjs`：各 provider 取对应 env；跨 provider 不回退到别家 key；同 provider 沿用。
- `model-command.test.mjs` 扩展：跨 provider 无 key 拒绝；有 key 成功且 llmClient.reconfigure 收到新 key；`/model "foo bar"` 拒绝；active 唯一。
- `config.test.mjs` 扩展：仅 provider → 预设补齐；冲突 warning；字段 source 正确（default/file/env/cli）。
- `context-budget` / `compact-auto`：按模型窗口计算；未知模型走 legacy 并标注。
- `statusline.test.mjs`：显示 provider·model，窄屏截断；重试/降级标记。
- `llm-client`：错误消息含 model 与 host、不含 key；`/models` 失败降级（mock）。
- 回归：grep 断言 src 中不再有 `DEEPSEEK_API_KEY ??` 散落回退（resolve-llm.ts 除外）。

## 度量
改前/改后 `npm test` 通过/失败数对比；手动：DeepSeek→Kimi→Ollama 来回切换各发一轮消息，检查状态栏、`/config`、请求日志（`--inspect-request`，key 必须打码）三者一致。
