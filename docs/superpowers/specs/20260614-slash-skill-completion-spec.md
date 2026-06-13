# Slash Skill 与实时补全 Spec

## 背景

Qling 已有 slash command dispatcher、`/help`、未知命令纠错和本地 skill tool，但 `/skill` slash 命令仍走 discovery registry 的模拟动作，没有复用真实 skill 文件加载能力。TUI 输入框也没有 `/` 命令候选提示，用户需要记住完整命令。

## 目标

- `/skill`、`/skill list`、`/skill search <query>`、`/skill <name>` 使用真实本地 skill 文件系统能力。
- slash command 的帮助、纠错和 TUI 补全使用同一命令目录数据源，降低漏登记风险。
- TUI 输入 `/` 或无参数 slash 前缀时显示最多 5 个候选；按 `Tab` 接受最佳候选并保留尾随空格。
- 空输入 `Tab` 仍打开 `/agents`；普通非 slash 输入 `Tab` 保持现有提示。

## 非目标

- 不新增全屏命令面板、方向键候选选择或新依赖。
- 不改变 `SlashCommand.execute(args, context)` 签名。
- 不改变 session、memory、token 存储格式。
- `/skill <name>` 不自动注入系统 prompt，不触发模型调用。

## 行为要求

- `/skill` 与 `/skill list` 等价，列出当前工作区可用 skills。
- `/skill search <query>` 搜索名称、描述和 tags。
- `/skill <name>` 读取本地 skill 正文并输出；找不到时显示可用 skill 提示。
- `/skill --help` 显示 focused help，说明本地只读边界。
- 每个注册的 slash command 至少出现在命令目录中，并可被补全发现。
- TUI slash 补全提示必须随输入、退格、历史切换、Ctrl+L 重绘更新，且不破坏完整输入框底边。

## 验收

- 单元测试覆盖 `/skill` list/search/load/help。
- 单元测试覆盖 slash catalog 与 command registry 一致性。
- 单元测试覆盖 `/sk` 候选和 `Tab` 补全。
- `npm run ci:check` 通过。
