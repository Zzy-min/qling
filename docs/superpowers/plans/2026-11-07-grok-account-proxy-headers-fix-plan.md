# Grok Account 代理鉴权头部与客户端版本修复实施计划 (Implementation Plan)

## 1. 计划目标
解决 `grok-account` 调用时出现的 `HTTP 426 Upgrade Required (bad_request)` 错误，补全 xAI `cli-chat-proxy.grok.com` 所需的客户端版本头及身份标识头，恢复 Grok 账号正常推理。

## 2. 详细步骤
- [ ] 1. 在 `src/auth/grok.ts` 中实现 `getGrokCliHeaders()`：
  - 导出标准的 Grok CLI 协议头部定义，版本号设为 `"1.0.78"`（与本地已安装的 Grok CLI 一致）。
- [ ] 2. 修改 `src/providers/managed-auth.ts`：
  - 在生成 `grok-account` 请求头时注入 `User-Agent`、`x-grok-client-version`、`x-grok-client-identifier`、`X-XAI-Token-Auth`。
- [ ] 3. 修改 `src/cli/auth-models.ts`：
  - 在调用 Grok `/models` 获取可用模型列表时同样注入上述头部。
- [ ] 4. 运行 `npm run build` 确保 TypeScript 编译通过。
- [ ] 5. 运行全部单元测试确保无回归。
- [ ] 6. 运行真实 `qling run` 验证 Grok 推理成功。
- [ ] 7. 编写 Review 总结文档并向用户汇报。
