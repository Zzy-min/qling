# 轻灵 Shift+Tab Agent 模式循环实施计划

**Spec**: `docs/superpowers/specs/20260711-shift-tab-agent-mode-cycle-spec.md`

## 1. RED

- 新增 mode command 单测，覆盖三态循环、异常组合归一化和 status。
- 扩展 raw stdin TUI 测试，覆盖 `ESC [ Z`、草稿保留和普通 Tab 不回归。
- 扩展 catalog/help 测试，确保 `/mode` 可发现。

## 2. GREEN

- 新增纯模式状态读取与循环 helper，并实现 `/mode` 命令。
- 注册命令目录和 focused help topic。
- 在 `StreamUI` 键盘解析中识别 `ESC [ Z`，调用统一 `/mode cycle` 路径。
- 复用 REPL 现有 slash 后状态刷新逻辑更新 chrome/statusline。

## 3. Verify

- 运行 mode、plan、permissions、streaming TUI 和 streaming REPL 目标测试。
- 运行 build、完整 CI、audit、旧命名扫描和 `git diff --check`。
