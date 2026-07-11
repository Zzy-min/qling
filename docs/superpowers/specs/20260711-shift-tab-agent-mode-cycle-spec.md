# 轻灵 Shift+Tab Agent 模式循环 Spec

## Goal

在 TUI 中使用 `Shift+Tab` 快速循环当前进程的执行模式，减少频繁输入 `/plan` 和 `/permissions` 的成本。

## State Machine

1. `Agent / ask`（默认确认）→ `Plan / ask`（只读规划）
2. `Plan / ask` → `Agent / allow`（Always Agree，自动放行）
3. `Agent / allow` → `Agent / ask`

若当前权限为 `deny` 或其他非标准组合，下一次循环归一化进入 `Plan / ask`。

## Interaction

- Windows Terminal 常见 `Shift+Tab` 序列 `ESC [ Z` 必须被完整识别，不得把尾部 `Z` 插入输入框。
- 非空草稿保持原样；快捷键只改变运行模式，不提交草稿。
- 新增 `/mode status` 和 `/mode cycle`，键盘与 slash 使用同一切换逻辑。
- 切换完成后刷新顶部模式、权限状态和 statusline，并只恢复一个输入框。
- `allow` 在界面中明确标注为 `Always Agree`，但内部权限枚举保持 `allow`，不改存储格式。

## Boundaries

- 模式只影响当前进程，不写配置文件。
- Plan Mode 始终优先于 allow；Plan 状态下写工具仍被拒绝。
- 不改变普通 Tab 的 agents/补全行为。

## Acceptance

- `/mode cycle` 完成三态循环并输出当前状态。
- raw stdin 收到 `\x1b[Z` 时提交 `/mode cycle`，不污染输入缓冲。
- 连续三次 Shift+Tab 回到 `Agent / ask`。
- 现有 Tab、slash、输入队列和 Plan Mode 测试保持通过。
