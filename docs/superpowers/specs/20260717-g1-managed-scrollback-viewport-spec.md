# G1 Managed Scrollback Viewport 规格

## 目标

把当前只显示用户轮次标题的 `turns` 浮层升级为真实 scrollback viewport：面板展示该轮实际用户、助手和工具内容，拥有独立页偏移，不依赖终端原生 scrollback 位置。

## 行为契约

- `StreamUI` 的展示缓冲与 Agent 消息历史分离；缓冲只保存已经呈现到本地终端的文本。
- 每条用户输入开启一个新轮次；后续助手和工具输出归入当前轮次。
- 最多保留最近 40 个轮次、每块文本最多 20 KiB，防止 UI 缓冲无界增长。
- `Tab` 或 Shift+↑/↓ 进入 viewport；↑/↓ 和 Shift+↑/↓ 按用户轮导航。
- PageUp/PageDown 在当前轮内容内翻页；到页边界后不循环。
- Enter、Space、`i` 返回输入焦点；Esc 关闭并恢复可编辑输入。
- 会话恢复时从已加载的 user/assistant 消息重建 viewport；不读取隐藏 system/tool 历史正文。
- viewport 只渲染本地文本，不调用模型、不联网、不写远程状态。

## 兼容

- 浮层种类继续使用 `turns`，保持现有 REPL 和公开测试入口兼容。
- 会话选择器、选项切换器和 append-only 正常输出路径不改变。
- 长轮次只在 viewport 内分页；原始终端输出仍按现有折叠规则显示。

## 验收

- 纯状态模型覆盖轮次归属、CJK 宽度换行、页边界、容量淘汰。
- StreamUI 驱动测试确认面板展示真实助手/工具内容，PageUp/PageDown 改变页面且不追加重复面板。
- `npm run build`、`npm run ci:check`、`node scripts/eval-recovery.mjs`、`git diff --check` 通过。
