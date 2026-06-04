# `qingling` 本地数据留存报告规格（2026-05-31）

## 背景

目标要求“追求稳定，数据留存本地”。当前 `/context` 和 `/doctor` 已展示部分本地路径，但用户缺少一个专门回答“轻灵把本地状态放在哪里、哪些数据不会因为命令而上传、哪些边界仍需注意”的入口。

## 目标

- 新增 `/privacy` slash command，中文别名 `/隐私`。
- 输出本地数据落点：workspace、state dir、sessions dir、cache dir、saved session count。
- 输出运行边界说明：本命令只读取本地状态，不上传；模型请求仍会按当前 provider 配置发送必要上下文。
- 输出可操作提示：需要查看上下文占用用 `/context`，需要诊断稳定性用 `/doctor`。
- 默认中文输出，保持紧凑、可复制。

## 非目标

- 不伪称全链路离线。
- 不修改模型 provider、网络策略或权限策略。
- 不扫描消息正文。
- 不新增持久化数据。

## 行为

- `/privacy` 从 AgentLoop 和 slash context 读取本地路径与 session 列表。
- 如果目录缺失，仍输出将使用的路径，不把缺失视为失败。
- 如果无法读取 session 列表，保存快照数量显示为 0。
- 报告包含明确边界：`模型请求仍按 provider 配置发送`。

## 验收

- 单测覆盖 privacy formatter 的路径、快照数量和边界说明。
- slash 单测覆盖 `/privacy` 与 `/隐私`。
- `/help` 列出 `/privacy`。
- `npm run build`、相关单测和 `npm run ci:check` 通过。
