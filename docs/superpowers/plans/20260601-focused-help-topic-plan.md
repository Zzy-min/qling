# 聚焦帮助主题实施计划（2026-06-01）

## Step 1: RED 测试

- 新增 `tests/unit/help-topics.test.mjs`：
  - 英文、slash、中文别名都能解析到同一主题。
  - slash 输出包含 slash 用法和中文别名。
  - top-level 输出包含 `qling ...` 示例。
  - 未知主题输出可读降级提示。
- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/help exports` 输出聚焦帮助。
  - `/? 权限` 输出权限聚焦帮助。
- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `help exports` 和 `帮助 权限` 路由为 help mode 且保留 subArgs。
  - `buildHelpText("qling", "exports")` 输出聚焦帮助。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - `qling help exports` 退出码为 0，输出聚焦帮助，不泄露 env secret。

## Step 2: 静态帮助主题模块

- 新增 `src/help-topics.ts`：
  - 定义 topic 数据表。
  - 提供 `findHelpTopic()`、`formatFocusedHelp()`。
  - 主题输出包含用法、别名、示例、边界说明。

## Step 3: 接入 slash 与 top-level

- 更新 `src/commands/help.ts`：
  - 无参数保留原总览。
  - 有参数时调用 `formatFocusedHelp(..., { surface: "slash" })`。
- 更新 `src/cli/startup-contract.ts`：
  - `buildHelpText(binName, topic?)` 支持聚焦帮助。
- 更新 `src/index.ts`：
  - `decision.mode === "help"` 时传入 `decision.subArgs` 的主题。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/help-topics.test.mjs" "tests/unit/slash-commands.test.mjs" "tests/unit/cli-startup.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
