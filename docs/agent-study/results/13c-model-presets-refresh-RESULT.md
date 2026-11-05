# 13c model-presets-refresh RESULT (second run, qling-r4-13c2)

## Status: done; acceptance passed
- Pi session qling-r4-13c2 (magpie/codex-router/grok-4.7). Port 3425 was listening before dispatch, and the command ended with `< NUL`.
- **0 model errors** this run.
- The first run (qling-r4-13c) hit 3 gateway errors and changed nothing.
- Snapshot: C:\Users\Lenovo\qling-agent-study\r4\pre13c. The repo was unchanged after the first run, so this snapshot is the baseline.

## Preset changes (sources: official docs, checked 2026-10-16)
| Preset | Old model | New model | Window / max output | Source |
|---|---|---|---|---|
| deepseek | deepseek-chat | deepseek-flash (DeepSeek-V4.1-Flash) | 1,000,000 / 393,216 | https://api-docs.deepseek.com/quick_start/pricing , https://api-docs.deepseek.com/updates/ |
| dashscope | qwen-plus | qwen3.7-plus | 1,000,000 / 131,072 | https://help.aliyun.com/zh/model-studio/qwen3-7-plus |
| zhipu | glm-4 | glm-5.3 | 1,000,000 / 131,072 | https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3 |
| moonshot | moonshot-v1-8k | kimi-k3 | 1,000,000 / not set | https://platform.kimi.com/docs/models.md |
| minimax | MiniMax-M2.7 | MiniMax-M3 | 1,000,000 / not set | https://platform.minimaxi.com/docs/guides/text-generation |
| mimo, mimo-token-plan | MiMo-V2.5-Pro | mimo-v2.6-pro | 1,000,000 / 131,072 | https://mimo.mi.com/docs/en-US/quick-start/summary/model |
| siliconflow | Qwen/Qwen2.5-7B-Instruct | deepseek-ai/DeepSeek-V4.1-Flash | Window not set (not verified) | https://www.siliconflow.cn/models |
| openai | gpt-4o | gpt-6-astra | 1,050,000 / 131,072 | https://platform.openai.com/docs/models |
| ollama / local | llama3 | unchanged | unchanged | — |

Other current models added to KNOWN_MODEL_WINDOWS:
- deepseek-v4-pro, plus the compatibility alias deepseek-v4-flash
- glm-5.3-flash, glm-5.2
- kimi-k2.7-code, kimi-k2.6 (256K)
- mimo-v2.6-flash
- gpt-6.1-sol

Kept: qwen-plus, glm-4, gpt-4o, gpt-4o-mini, Qwen/Qwen2.5-7B-Instruct, llama3, MiniMax-M2.7.

Removed (officially retired):
- deepseek-chat, deepseek-reasoner
- moonshot-v1-8k/32k/128k
- MiMo-V2.5-Pro

The new RETIRED_MODELS table and lookupRetiredModel mean that if the current model is one of these, `/model status` shows "该模型已下线，建议换成 X". The config is not rewritten silently.

## Changed files (relative to pre13c)
- src/providers/presets.ts: presets, window table, RETIRED_MODELS
- src/commands/claude-style.ts: retired-model hint in /model status
- Hard-coded fallback default changed from deepseek-chat to deepseek-flash, one line each:
  - src/config.ts (mixed file; only that one line changed, user hunks untouched)
  - src/providers/resolve-llm.ts
  - src/context-compactor.ts
  - src/pipeline/verification.ts
  - src/tui/streaming-tui.ts
- Tests:
  - New: tests/unit/model-presets-refresh.test.mjs
  - Updated: compact-auto, config, model-command, provider-presets, provider-key-resolution, provider-model-filter
- Endpoints not changed. MiniMax is still api.minimaxi.com; the official docs now say api.minimax.cn.

## Acceptance (before → after)
| Item | Before | After |
|---|---|---|
| tsc | 0 | 0 |
| npm test | 1515 / 1514 / 0 fail / 1 skip | 1520 / 1519 / 0 fail / 1 skip |
| eval:recovery | ok 15 | ok 15 |
| eval:tasks | passed | passed |
| Root | clean | no new files |

Mock and fake keys only. No commit, no new dependencies.

## Unfinished / not verified
- README and docs/install.md were not changed (no diff). If they still mention old default models, they need a follow-up edit.
- SiliconFlow: DeepSeek-V4.1-Flash window, and whether Qwen2.5-7B is still served.
- Max output not published for Kimi K3 and MiniMax-M3, so left unset.
- GPT-6 Luna: no model ID found, not added.
- No retirement evidence found for gpt-4o, glm-4, qwen-plus, so kept.
- deepseek-v4-flash is a temporary compatibility alias per the official docs; remove it when it is retired.
