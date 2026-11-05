# Brief 13b：模型列表按当前服务商过滤（qling）
来源：用户原话「选好一个服务商后，模型列表可以做成只含有此服务商提供的模型」。
基线：codex/agent-reliability-v3，工作区已包含 brief 12、13 的改动（npm test 1505 个，0 失败）。

## 要做
1. `/model` 的 picker 和 `/model list` 只显示**当前会话服务商**的模型：该服务商的预设、已知模型（presets.ts / 已知模型窗口表里归属该 provider 的条目），加上当前正在用的模型。其他服务商的预设不出现。
   - `/model use <preset>` 仍然可以显式切到别家服务商（切换规则不变，照旧按 brief 13 的 Key 规则拒绝或放行）。
2. `/model list --remote`：只用**当前服务商的 endpoint 和 Key** 请求 GET {endpoint}/models，结果只显示这一家的。
3. `qling models` 默认按当前服务商过滤；加 `--all` 才列出所有预设服务商的预设模型。`--all` 不对其他服务商发远程请求，也不读其他服务商的 Key。
4. 未知服务商、远程列表为空或请求失败时，给一行提示，并回退到该服务商的预设列表。如果连预设都没有，就显示当前模型，并提示用 `/model use <preset>`。
5. 帮助文本（help-topics / startup-contract 帮助行 / README 的 /model 段）补一句过滤规则和 `--all` 的用法。

## 不做 / 约束
- 不改 brief 12 的重试逻辑；不改 brief 13 的 Key 解析规则（只能更严）。
- 不新增出站目标；不打印 Key。
- 测试只用假 Key 和 127.0.0.1:0 mock server。
- 不 commit / push；不读 .env；不加依赖；不删用户未提交的内容（混改文件只做最小增量）。

## 测试
- provider=deepseek 时，picker 和 list 只包含 deepseek 的条目；切到 moonshot（有假 Key）后只剩 moonshot 的；picker 高亮最多 1 项。
- --remote：mock server 断言请求的 host 是当前 endpoint、Authorization 是当前服务商的假 Key；返回空列表或 500 时回退到预设并给出提示。
- 未知 provider：给出提示，回退到当前模型。
- `qling models` 默认过滤；`--all` 列出全部预设，且没有远程请求打到其他 host。
