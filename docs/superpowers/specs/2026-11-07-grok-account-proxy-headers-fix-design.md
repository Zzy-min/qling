# Grok Account 代理鉴权头部与客户端版本修复设计规范 (Grok Account Proxy Headers Fix)

## 1. 问题分析与根本原因
用户使用 Grok 官方账号登录轻灵（`grok-account`，方式：`grok_cli_session`），本地状态正常显示为 `ready`，但发起任何模型推理调用时均报错失败：
```
模型调用失败：bad_request（426/bad_request），已重试 0 次 / 已尝试模型 [grok-4.7]
```
经针对 `https://cli-chat-proxy.grok.com/v1/chat/completions` 的排查与网络搜索证据确认：
- xAI 针对其官方 CLI 代理端点（`cli-chat-proxy.grok.com`）强制校验了客户端客户端版本及配套追踪头。
- 若缺少 `x-grok-client-version`、`User-Agent: xai-grok-cli`、`x-grok-client-identifier: grok-shell` 等头部，服务端会判定为“客户端版本过旧或缺失”，直接返回 **HTTP 426 Upgrade Required (bad_request)**。
- 轻灵此前在 `src/providers/managed-auth.ts` 与 `src/cli/auth-models.ts` 中仅传递了 `X-XAI-Token-Auth: xai-grok-cli` 和 `x-grok-model-override`，漏掉了 `x-grok-client-version`（需匹配如 `1.0.78`）、`User-Agent` 与 `x-grok-client-identifier`。

## 2. 解决方案与架构改动
1. **统一 Grok CLI 协议头生成**：
   - 在 `src/auth/grok.ts` 中导出标准的 `grokCliHeaders()` 构造器，包含：
     - `X-XAI-Token-Auth`: `"xai-grok-cli"`
     - `User-Agent`: `"xai-grok-cli"`
     - `x-grok-client-version`: 优先探测已安装 CLI 版本，默认兜底 `"1.0.78"`
     - `x-grok-client-identifier`: `"grok-shell"`
2. **鉴权头与模型查询补齐**：
   - `src/providers/managed-auth.ts`：在 `options.provider === 'grok-account'` 时，注入全部 Grok CLI 协议头部。
   - `src/cli/auth-models.ts`：在请求 `${profile.endpoint}/models` 时同步补充上述头部。
   - `src/providers/llm-client.ts`：确保 Axios 请求头不被默认 User-Agent（如 `axios/...`）覆盖。

## 3. 验证标准
1. 使用用户已登录的 Grok 账号端到端运行真实推理：`qling run "简单测试：请回复 OK"`，验证成功返回文本（不再报 426）。
2. 全部既有单元测试保持 100% 通过。
