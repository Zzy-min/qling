# Grok Account 代理调用 Headers 修复复盘 (Review)

## 1. 背景与问题
用户使用 `qling auth login` 完成了 Grok 账号（CLI OAuth 会话）登录，本地状态显示为 `ready`，但在进行实际模型调用时报错：
```
模型调用失败：bad_request（426/bad_request），已重试 0 次 / 已尝试模型 [grok-4.7]
```

## 2. 根因分析
1. **xAI CLI 代理端点校验机制**：
   `grok-account` 会话调用的是 xAI 官方 CLI 专用内部代理端点 `https://cli-chat-proxy.grok.com/v1`。
2. **HTTP 426 Upgrade Required**：
   该反向代理对请求头有极其严格的客户端版本与来源白名单校验。如果缺失 `x-grok-client-version` 请求头，或者请求头不匹配官方 CLI 规范，服务器会立即返回 HTTP 426，要求升级客户端。
3. **原有代码缺陷**：
   在 `src/providers/managed-auth.ts` 中，只携带了 `X-XAI-Token-Auth: xai-grok-cli`，遗漏了：
   - `User-Agent: xai-grok-cli`
   - `x-grok-client-version: 1.0.78`（读取 `GROK_CLI_VERSION` 环境变量，未设置时使用代码内默认值；不探测已安装 CLI）
   - `x-grok-client-identifier: grok-shell`

## 3. 修复方案
1. **`src/auth/grok.ts`**：
   - 新增 `getGrokCliHeaders()` 函数。
   - 只读取 `GROK_CLI_VERSION`，默认值为 `1.0.78`；没有 CLI 版本探测或缓存。
   - 组装并返回标准 4 组请求头。
2. **`src/providers/managed-auth.ts`**：
   - 在 `managedRequestHeaders` 中，针对 `grok-account` 合并 `getGrokCliHeaders()`。
3. **`src/cli/auth-models.ts`**：
   - 在 `listPendingAccountModels` 中对 `grok-account` 同步补充该组请求头，确保拉取远端模型列表不被拦截。

## 4. 当前验证边界

`tests/unit/auth-review-corrections.test.mjs` 使用注入的凭据与 HTTP/Axios transport 覆盖 pending discovery、active discovery 和 inference 的版本、identifier、User-Agent、token-auth 请求头；不执行已安装的 Grok CLI，也不读取真实会话或调用真实模型。

可运行：`node --experimental-test-module-mocks --test tests/unit/auth-review-corrections.test.mjs`。

旧稿中的 39 项命令引用了树中不存在的 `modernized-catalog.test.mjs`，不能作为可复现的当前证据。历史构建或真实推理叙述也不证明当前提交的真实账户兼容性；HTTP 426 的服务端具体判定尚未在当前修订中独立验证。
