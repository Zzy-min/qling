# TUI Bare Escape Stability Plan

## 步骤

1. 在 `tests/unit/streaming-tui-ctrl-c.test.mjs` 添加 RED 测试：单独 `Esc` 后普通输入应保留。
2. 添加测试：单独 `Esc` 不提交输入。
3. 在 `StreamUI` raw stdin handler 入口处理 `chunk === "\x1b"`，作为本地 no-op 并清空未完成 partial。
4. 更新 `src/shortcuts.ts` 帮助文案。
5. 补 `/shortcuts` 断言。
6. 运行定向测试、完整 CI、旧名扫描、安全审计、diff/staged 检查，提交并推送。

## 风险控制

- 只处理单独 `Esc` chunk，不改完整 escape 序列分发。
- 不新增磁盘写入、模型调用或中断控制。
- 现有方向键、Delete、Alt 组合键测试作为回归保护。
