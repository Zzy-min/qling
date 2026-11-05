# Brief 13c: 刷新服务商预设到最新官方模型

背景：用户反馈「DeepSeek 最新模型都更新到 4.1 了，你还显示 V4 flash」。src/providers/presets.ts 里的预设和 KNOWN_MODEL_WINDOWS 已过时。下面的模型 ID 和窗口都来自官方文档（查询日期 2026-10-16），**只按此表改，不要自行添加表外模型或数值**。

## 1. 预设默认模型（PRESET_MAP 的 model 字段）

| preset id | 旧 model | 新 model | 窗口 / 最大输出 | 来源 |
|---|---|---|---|---|
| deepseek | deepseek-chat | `deepseek-flash`（= DeepSeek-V4.1-Flash） | 1,000,000 / 393,216 (384K) | https://api-docs.deepseek.com/quick_start/pricing ；https://api-docs.deepseek.com/updates/ |
| dashscope | qwen-plus | `qwen3.7-plus` | 1,000,000 / 131,072 | https://help.aliyun.com/zh/model-studio/qwen3-7-plus |
| zhipu | glm-4 | `glm-5.3` | 1,000,000 / 131,072 (128K) | https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3 |
| moonshot | moonshot-v1-8k | `kimi-k3` | 1,000,000 / 不填 | https://platform.kimi.com/docs/models.md |
| minimax | MiniMax-M2.7 | `MiniMax-M3` | 1,000,000 / 不填 | https://platform.minimaxi.com/docs/guides/text-generation |
| mimo, mimo-token-plan | MiMo-V2.5-Pro | `mimo-v2.6-pro` | 1,000,000 / 131,072 (128K) | https://mimo.mi.com/docs/en-US/quick-start/summary/model |
| siliconflow | Qwen/Qwen2.5-7B-Instruct | `deepseek-ai/DeepSeek-V4.1-Flash` | 不填（官方页未核实窗口） | https://www.siliconflow.cn/models |
| openai | gpt-4o | `gpt-6-astra` | 1,050,000 / 131,072 (128K) | https://platform.openai.com/docs/models |
| ollama / local | llama3 | 不改 | 不改 | 本地模型，无官方"最新"概念 |

## 2. KNOWN_MODEL_WINDOWS 增加的同服务商其他现役模型（让 /model 列表能显示）

- deepseek: `deepseek-v4-pro` 1,000,000 / 393,216
- 兼容别名（官方仍接受，路由到 V4.1 Flash）: `deepseek-v4-flash` 1,000,000 / 393,216
- zhipu: `glm-5.3-flash` 1,000,000 / 131,072；`glm-5.2` 1,000,000 / 131,072
- moonshot: `kimi-k2.7-code` 256,000；`kimi-k2.6` 256,000
- minimax: `MiniMax-M2.7` 204,800（保留，仍正常提供）
- mimo: `mimo-v2.6-flash` 1,000,000 / 131,072
- openai: `gpt-6.1-sol` 1,050,000 / 131,072
- dashscope: 保留 `qwen-plus` 现有条目不动

注意 knownModelsForProvider 按前缀归属：确认 deepseek-v4-pro、glm-5.3-flash、kimi-k2.x、mimo-v2.6-flash、gpt-6.1-sol 能归到对应服务商（必要时给归属逻辑加最小的显式映射，不要放宽到跨服务商）。

## 3. 已下线、要从列表移除的 ID（不保留为别名）

官方已明确下线：
- `deepseek-chat`、`deepseek-reasoner`：2026-07-24 下线（见 DeepSeek updates）。
- `moonshot-v1-8k/32k/128k`：2026-08-31 下线（见 Kimi 模型列表）。
- `MiMo-V2.5-Pro`：2026-10-21 下线，目前已自动路由到 v2.6-pro。

要求：
- 从 KNOWN_MODEL_WINDOWS 删除这些条目。
- 用户若在配置里仍写着旧 ID，lookupModelWindow 返回 null 即可。不要做静默改写。
- 可选：在 /model status 给一条「该模型已下线，建议换成 X」的提示。用一张小的 RETIRED_MODELS 表实现，表里只放上面这些 ID。

保留不动：`gpt-4o`、`gpt-4o-mini`、`glm-4`、`qwen-plus`、`Qwen/Qwen2.5-7B-Instruct`、`llama3`。这些我没有查到官方下线证据，不要删。

## 4. 其他

- 更新 KNOWN_MODEL_WINDOWS 上方的注释，写明数值来源和日期 2026-10-16。
- 测试：
  - 更新所有断言旧默认模型的测试（例如 deepseek-chat、moonshot-v1-8k、glm-4、gpt-4o 作为默认值的断言），改成新 ID。
  - 新增 `tests/unit/model-presets-refresh.test.mjs`，覆盖以下几点：
    - 每个预设的默认模型等于本表。
    - 窗口数值等于本表。
    - deepseek 列表包含 deepseek-flash 和 deepseek-v4-pro，不含 deepseek-chat。
    - 下线 ID 的 lookupModelWindow 返回 null。
    - 下线提示，如果实现了的话。
  - 只用 mock 和假 key。
- 文档：README、docs/install.md 里提到旧默认模型的地方同步改。只改相关行。
- 不改 endpoint。MiniMax 官方文档现在写的是 api.minimax.cn，预设里是 api.minimaxi.com，这次不动，只在 RESULT 里注明。
- 不改 brief 12 的重试逻辑、brief 13 的 key 规则、brief 13b 的过滤逻辑（安全只能更严）。

## 验收
- tsc 通过。
- npm test 0 失败，基线 1515。
- eval:recovery ok 15。
- eval:tasks 通过。
- 根目录干净。
