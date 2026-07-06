# 轻灵中文本地化与 UI 体验增强 Plan

## Steps

1. 新增 `src/i18n/`，提供默认 `zh-CN` 文案对象和只读访问函数。
2. 新增统一 guidance panel formatter，供 CLI 与 slash 错误复用。
3. 将 `startup-contract` 中的本地纠错、缺任务、模式冲突、无效选项错误切到统一 formatter。
4. 将 slash 未知命令纠错切到统一 formatter，保持候选命令和普通输入提示不变。
5. 调整 `runSetup()`：API key 不写入 `.env`，输出系统环境变量配置提示；`.env` 只保留 provider/model/endpoint 和高级非敏感开关。
6. 新增/更新单测：i18n、guidance formatter、CLI 错误、slash 未知命令、setup 安全文案。
7. 验证：`npm run build`、目标单测、`npm run ci:check`、旧名扫描、`git diff --check`、`npm audit --audit-level=high`。

## Constraints

- 不改变用户命令语义。
- 不保存或打印明文密钥。
- 不在本轮改 dashboard 或 knowledge/RAG。
- 仅建立中文单一事实源；未来多语言切换不作为本轮交付。
