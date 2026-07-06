# 轻灵中文本地化与 UI 体验增强 Final Audit

## Scope

本轮按 `20260706-zh-localized-ui-roadmap-plan.md` 完成 P0-P4：

- P0：中文本地化文案与错误体验统一。
- P1：TUI 专属本地化界面升级。
- P2：本地 Web Dashboard 升级。
- P3：中文知识库 / RAG 默认值。
- P4：国内平台连接器引导。

## Evidence

- P0：`src/i18n/zh-cn.ts`、`src/cli/guidance-panel.ts`、setup/bootstrap/doctor/help/unknown-command 输出已接入本地化与安全密钥引导。
- P1：`src/tui/shell.ts`、`src/tui/markdown.ts`、`src/tui/streaming-tui.ts` 提供中文首页、分组命令面板、Markdown/表格/长输出与长输入渲染增强。
- P2：`src/dashboard-server.ts` 提供本地只读中文 Dashboard HTML 与 sessions/permissions/doctor 等 API 摘要。
- P3：`src/commands/knowledge.ts` 与 top-level `qling knowledge` 提供中文 chunk、索引、查询、引用链路和本地边界提示。
- P4：`src/commands/connect.ts` 与 top-level `qling connect` 提供 Telegram/Slack/Feishu/DingTalk/WeChat 向导、token 检查与脱敏错误提示；`doctor` 增加连接器诊断。

## Verification

- `npm run ci:check`：通过，619 个 unit + 67 个 smoke，0 fail。
- `npm run build && node --test tests\smoke\dashboard.smoke.test.mjs`：通过，用于确认最终 dashboard 格式修复无行为回归。
- 旧英文名扫描（排除 node_modules/dist/.git）：无命中。
- `git diff --check`：通过。
- `npm audit --registry=https://registry.npmjs.org --audit-level=high`：0 vulnerabilities。

## Final Notes

- 本轮不引入重型 UI 框架，不改变 session/memory/token 存储格式。
- setup/connect/doctor 均保持 local-first：不保存明文密钥到 `.env`，不在帮助/诊断输出中泄露 secret。
- P3 knowledge 采用本地索引与 memory 搜索增强；缺少真实 semantic/embedding 时输出友好降级提示。
