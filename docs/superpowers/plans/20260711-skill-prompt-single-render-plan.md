# 轻灵 Skill 调用后输入框单次渲染实施计划

**Spec**: `docs/superpowers/specs/20260711-skill-prompt-single-render-spec.md`

## 1. Reproduce

- 在 `streaming-repl-queue.test.mjs` 中以 UI recorder 执行真实 `/skill list`。
- 断言 skill 输出仍通过 UI 呈现，并统计 `showPrompt()` 次数。

## 2. Fix

- 保留 `handleUserInput()` 作为输入框恢复的唯一所有者。
- 删除 `handleQueuedUserInput()` slash 分支中的内部 `showPrompt()`。
- 保留立即队列控制命令的独立路径，因为它绕过普通输入队列。

## 3. Verify

- 运行 streaming REPL queue 与 streaming TUI 输入框测试。
- 运行 build、完整 CI 和 `git diff --check`。
- 检查差异，确认未混入 Dashboard 之外的未知改动。
