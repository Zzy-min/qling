# Grok Build TUI 交互同功能对比与轻灵改进规格

## 目标

以官方 `xai-org/grok-build` 当前开源源码为基线，改进轻灵全屏 TUI 的鼠标拖选复制、滚动与底部功能键，使三者可以同时工作，不再依赖互斥的 QuickEdit“复制模式”。

## 官方源码对比

- `app/mod.rs`
  - 全屏时同时启用 alternate screen、mouse capture、focus change、bracketed paste 和增强键盘协议。
  - 退出前先排空渲染，再对称恢复鼠标、焦点、键盘、光标和屏幕。
- `app/mouse.rs`
  - 分别处理 `Down`、`Drag`、`Up`、`Moved` 和滚轮。
  - 鼠标拖选、滚动条、链接、输入框和功能按钮通过命中区域路由，不互相抢占。
- `app/agent_view/selection.rs`
  - 选区锚点绑定逻辑内容而非单纯屏幕坐标。
  - 松手时重建文本、自动写剪贴板并保留持续高亮。
  - 拖到视口边缘可自动滚动，渲染后重新校准选区端点。
- `input/mouse.rs`
  - 将原始滚轮事件按短流合并，默认 16ms 刷新，并区分滚轮与触控板，避免幅度过大和卡顿。
- `actions/defaults.rs` 与 `agent_view/prompt.rs`
  - 功能键由集中动作注册表决定；Shift+Tab 模式切换、PageUp/PageDown、输入编辑和复制不会因鼠标选择而失效。

## 轻灵现状差距

- `FullscreenRenderer.start()` 仅启用 `1000` 与 `1006`，没有 `1002` drag 报告。
- `StreamingTUI.setupInput()` 只提取滚轮，随后删除所有 SGR mouse 事件。
- Alt+C 会关闭应用鼠标捕获、启用 Windows QuickEdit；这使滚轮与拖选复制互斥。
- 复制依赖用户再按终端快捷键，轻灵本身不知道选区内容，也无法给出可靠成功反馈。
- 底栏写“Alt+C 复制”，实际行为却是切换模式。

## 设计

### 鼠标协议

- 新增纯函数解析 SGR mouse：
  - 左键按下 `Down`
  - 按住移动 `Drag`
  - 左键松开 `Up`
  - 滚轮上下
- 启用 `1002` button-event tracking；保留 `1000`、`1006`。
- 鼠标事件与剩余键盘输入分离，同一个数据块中的功能键不得丢失。

### 逻辑选区

- `FullscreenRenderer` 为每个可见正文屏幕行缓存对应的逻辑正文行号。
- 选区锚点和端点使用“逻辑行 + 可见单元格列”，因此滚动期间仍可扩展选择。
- 选择文本按终端显示宽度切片，正确处理中文全角字符和 ANSI 样式。
- 松手时自动写入剪贴板；成功后保留选区高亮。
- Alt+C 不再切换终端模式，而是重新复制当前持久选区。
- 单击不复制，并清除旧选区；拖选过程中键盘输入和底部功能键保持可用。

### 滚动

- 保留现有 16ms 合并。
- 滚轮解析与拖选事件统一完成，避免先删事件再分派。
- 拖选到正文视口顶部或底部时，以小步幅滚动并继续扩展逻辑选区。

### 剪贴板

- 渲染器通过注入的 `writeClipboard` 端口写入，不直接访问业务状态。
- 默认端口复用本机剪贴板实现；测试使用内存端口。
- 剪贴板失败不破坏选区或输入，底栏显示可重试语义。

## 涉及文件

- `src/tui/fullscreen.ts`
- `src/tui/streaming-tui.ts`
- `src/tui/clipboard.ts`（共享本机剪贴板端口）
- `src/commands/claude-style.ts`（复用共享写入实现）
- `tests/unit/tui-fullscreen.test.mjs`
- 必要时增加剪贴板纯函数测试。

## 验证

- RED→GREEN：SGR mouse 解析、拖选自动复制、多行与中文宽度、持久高亮、滚动扩展、Alt+C 重复制。
- 确认 Shift+Tab、Enter、Ctrl+C、PageUp/PageDown 和斜杠输入在选区存在时仍能分派。
- 构建、TUI 定向测试、完整单元测试、smoke、eval、打包、依赖分层和 `git diff --check`。
- Windows Terminal 真实伪 TTY/人工路径：拖选、松手粘贴验证、滚轮、Shift+Tab、任务执行时固定顶栏与输入框。

## 安全与边界

- 剪贴板内容只写本机，不记录日志、不进入会话和遥测。
- 不删除现有 `windows-native-selection.ts`；它保留为兼容后备，但默认路径不再切换 QuickEdit。
- 不改变 Agent、审批、任务队列和 Slash Command 业务逻辑。
