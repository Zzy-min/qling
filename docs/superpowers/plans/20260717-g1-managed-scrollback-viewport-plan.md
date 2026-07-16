# G1 Managed Scrollback Viewport 实施计划

1. 新增无终端副作用的 `ScrollbackViewport`，管理轮次、块、宽度换行和页偏移。
2. 将用户、助手和工具呈现事件写入 viewport；会话回放时确定性重建。
3. `turns` 浮层改为渲染真实内容；↑/↓ 切轮次，PageUp/PageDown 翻页。
4. 保持 Enter/Space/Esc/Tab 焦点语义以及会话切换器互斥。
5. 增加状态模型和 StreamUI 驱动测试，更新快捷键说明并运行完整门禁。
