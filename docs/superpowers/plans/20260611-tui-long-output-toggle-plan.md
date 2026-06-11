# TUI Long Output Toggle Plan

## 步骤

1. 在 `tests/unit/streaming-tui-ctrl-c.test.mjs` 先加入 RED 测试，覆盖默认折叠、Ctrl+O 展开、再次折叠、raw stdin 不提交输入。
2. 在 `StreamUI` 增加本地布尔状态 `expandLongToolOutput`。
3. 实现 `handleCtrlO()`，切换状态并打印本地提示后重绘输入。
4. 修改 `printToolOutput()`：默认沿用现有折叠；展开模式打印完整输出并提示可用 Ctrl+O 恢复折叠。
5. 更新 `src/shortcuts.ts` 的 Ctrl+O 说明。
6. 运行定向测试、完整 CI、旧名扫描、安全审计、diff/staged 检查，再提交推送。

## 风险控制

- 不重排已输出历史，避免终端控制序列在不同 shell 中不稳定。
- 仅影响显示层，不改 tool result 数据。
- 保持默认折叠，避免引入大输出性能回退。
