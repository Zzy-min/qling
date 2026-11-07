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
   - `x-grok-client-version: 1.0.78`（动态优先读取本地安装的 grok 版本，降级为最新已知版本）
   - `x-grok-client-identifier: grok-shell`

## 3. 修复方案
1. **`src/auth/grok.ts`**：
   - 新增 `getGrokCliHeaders()` 函数。
   - 包含缓存机制探测本地 `grok --version`（当前探测到 `1.0.78`）。
   - 组装并返回标准 4 组请求头。
2. **`src/providers/managed-auth.ts`**：
   - 在 `managedRequestHeaders` 中，针对 `grok-account` 合并 `getGrokCliHeaders()`。
3. **`src/cli/auth-models.ts`**：
   - 在 `listPendingAccountModels` 中对 `grok-account` 同步补充该组请求头，确保拉取远端模型列表不被拦截。

## 4. 验证结果
1. **构建与类型检查**：
   - `npm run build` 成功，TypeScript 编译 0 error，前端 Vite 构建 0 error。
2. **单元测试**：
   - 39 个单元测试全部通过：
     `node --test tests/unit/modernized-catalog.test.mjs tests/unit/model-command.test.mjs tests/unit/model-picker-grouping.test.mjs tests/unit/provider-model-filter.test.mjs` -> `39 pass, 0 fail`。
3. **真实调用端到端验证**：
   - 执行 `node dist/index.js run "请只回答四个字：验证成功"`：
     `grok-4.7` 响应迅速，成功返回 `验证成功`，HTTP 426 彻底消除。
