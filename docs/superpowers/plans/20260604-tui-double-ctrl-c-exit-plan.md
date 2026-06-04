# `qling` TUI 双 Ctrl+C 退出实施计划（2026-06-04）

## 阶段 1: RED

- 为 `StreamUI` 增加可注入时钟的单测场景。
- 先证明当前空输入 `Ctrl+C` 不会产生双击退出行为。

## 阶段 2: GREEN

- 在 `StreamUI` 内维护最近一次空输入 `Ctrl+C` 时间。
- 非空输入 `Ctrl+C` 保持清空输入，并重置双击状态。
- 空输入首次 `Ctrl+C` 输出提示。
- 空输入二次 `Ctrl+C` 在 2 秒窗口内调用输入回调提交 `exit`。

## 阶段 3: VERIFY

- 运行新增/目标单测。
- 运行 `npm run build`。
- 运行 `npm run ci:check`。
- 提交并推送到 `origin/main`。
