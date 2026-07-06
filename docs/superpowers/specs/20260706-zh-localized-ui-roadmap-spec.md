# 轻灵中文本地化与 UI 体验增强 Spec

## Goal

将轻灵的中文、本地化和 UI 体验增强按阶段落地。本轮先实现 P0：统一中文文案入口和错误/帮助面板，消除 setup 与安全提示之间的体验冲突，为后续 TUI、Dashboard、RAG 和连接器向导提供稳定文案基础。

## Requirements

- 新增默认 `zh-CN` 文案入口，先覆盖错误面板字段、边界说明、setup 密钥引导和常用入口文案。
- 新增统一 guidance/error panel formatter，固定包含：原因、下一步、示例、本地执行、模型调用、边界。
- CLI 参数错误、顶层命令纠错、slash 未知命令纠错必须使用同一 formatter。
- `qling setup` 不再默认把 API key 写入 `~/.qling/.env`；只保存非敏感 provider/model/endpoint 配置，并提示用户用系统环境变量配置 key。
- 输出不得泄露 `sk-`、token、secret、password 等敏感值。
- 保持 CLI 解析、slash command API、session/memory/token 存储格式不变。

## Non-goals

- 不在本轮实现完整多语言切换。
- 不重做 Web Dashboard。
- 不引入新的 TUI/Web UI 依赖。
- 不实现 RAG/knowledge 或 IM 连接器功能；这些属于后续阶段。

## Acceptance

- 新增 i18n 和 guidance formatter 单测。
- CLI 和 slash 未知命令输出包含统一字段，并明确“本地执行=是、模型调用=否”。
- setup 输出不把 API key 写入 `.env`，并给出 Windows PowerShell 环境变量示例。
- `npm run build`、相关单测和 `npm run ci:check` 通过。
