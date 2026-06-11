# Input History Control Filter Plan

## 步骤

1. 更新 RED 测试：`chat-exit` 不再期待 `exit` 写入历史；新增 REPL 单测覆盖 `/queue status` 不落盘、普通 prompt 落盘。
2. 调整 `StreamingREPL.handleQueuedUserInput()` 顺序：先 trim/退出/slash 处理，只有未被本地命令处理的真实 prompt 才调用 `recordLocalInputHistory()`。
3. 保持 `input-history.ts` 的敏感信息过滤、去重和 max entries 行为不变。
4. 运行定向测试、完整 `npm run ci:check`、旧名扫描和 diff 检查。
5. 暂存审计后提交并推送。

## 风险控制

- 不改变 slash 命令执行路径，只移动历史写入时机。
- 如果历史写入失败仍保持 best-effort，不阻塞 prompt 执行。
