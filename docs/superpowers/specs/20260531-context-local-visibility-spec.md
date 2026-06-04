# `qingling` 交互体验：本地 `/context` 可视化规格（2026-05-31）

## 背景

为贴近 Claude Code 的丝滑体验，用户需要随时知道当前会话占用了多少上下文、是否已压缩、数据保存在本机哪里，以及最近是否已有会话快照。当前 `/status` 偏运行统计，`/doctor` 偏环境诊断，缺少面向“上下文与本地留存”的解释入口。

## 目标

- 新增 `/context` slash command 与中文别名 `/上下文`。
- 输出当前会话的本地上下文报告：
  - session id
  - turn/message/token/compaction 统计
  - token budget 使用率
  - workspace/state/cache/sessions 路径
  - 最近保存的会话快照数量与最近更新时间
  - 本地留存说明
- 不访问公网，不上传上下文，不写入新诊断日志。

## 非目标

- 不展示完整消息内容。
- 不执行压缩；压缩仍由 `/compact` 负责。
- 不改变 session 持久化格式。

## 验收

- 单测覆盖 context report formatter、token budget 百分比和缺失 saved sessions 的降级。
- Slash command 单测覆盖 `/context` 与 `/上下文`。
- `npm run build` 通过。
- `node --test "tests/unit/context-report.test.mjs" "tests/unit/slash-commands.test.mjs"` 通过。
- `npm run ci:check` 通过。
