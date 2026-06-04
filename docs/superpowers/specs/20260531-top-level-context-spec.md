# `qingling context` 顶层本地上下文报告规格（2026-05-31）

## 背景

会话内 `/context` 已能查看当前 session 的上下文占用与本地留存路径。但用户在 shell 中排查配置、确认本地数据位置或查看是否已有保存快照时，不应必须进入 TUI 或初始化模型。

## 目标

- 新增顶层命令 `qingling context`。
- 新增中文别名 `qingling 上下文`。
- 在 `AgentLoop` 初始化前执行并退出，避免缺少 API key 或 provider 配置时阻断本地查看。
- 复用现有上下文报告格式，展示 workspace、state dir、cache dir、sessions dir、保存快照数量、最近保存时间和 token budget。
- 保持只读本地边界：不输出消息正文、不联网、不调用模型。

## 非目标

- 不恢复或切换会话。
- 不打开、删除、上传、压缩或检索正文。
- 不伪称存在当前交互 session；顶层模式没有活动会话时以占位值展示。
- 不改变 `/context` slash command 行为。

## 行为

- `qingling context` 输出“本地上下文”并以 exit code 0 退出。
- `qingling 上下文` 等价于 `qingling context`。
- 支持全局 `--file-state-dir`、`--file-cache-dir`、`--workspace` 配置解析。
- 会话快照数量和最近保存时间来自 `<stateDir>/sessions` 的本地会话注册表摘要。
- 与 `--continue` 或 `--resume` 组合时报模式冲突错误，保持管理命令一致性。

## 验收

- 单测覆盖 local context builder 能统计本地会话快照数量和最近保存时间。
- 单测覆盖 `context` 与 `上下文` 顶层解析。
- 单测覆盖 help 文案包含 `qingling context` 与 `上下文`。
- smoke 覆盖 `qingling 上下文` 可直接退出、输出本地上下文报告、且不输出 session 正文。
- `npm run build`、相关测试和 `npm run ci:check` 通过。
