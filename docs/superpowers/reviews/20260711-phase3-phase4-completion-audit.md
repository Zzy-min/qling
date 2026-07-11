# Phase 3/4 完整性审计报告

**日期**: 2026-07-11
**审计范围**: Phase 3 Harness Lean / Skills / Sub-agent / browser_act / mission notify，以及 Phase 4 LLM eval / code_symbols / LSP / dependency layers
**结论**: 计划内功能已落地并通过本地门禁，满足提交并推送 `main` 的条件；真实 provider/Telegram/Slack 凭据路径未验收，依赖层债务仍按 spec 保留。

## 1. 需求与证据矩阵

| 阶段 | 要求 | 当前证据 | 判定 |
| --- | --- | --- | --- |
| 3.0 | 长 tool output 折叠且受上限约束 | `context-tool-hygiene.test.mjs` 覆盖默认 head/tail、小 max、极小 max、JSON 保结构；AgentLoop 使用统一入口 | 已完成 |
| 3.0 | `/context` 展示历史/tool/其他层估计 | `context-report.test.mjs`、eval `harness-tool-output-hygiene` | 已完成 |
| 3.1 | Skill 仅索引进 prompt，正文按需加载 | `pipeline/sections.ts` + `skill.test.mjs` | 已完成 |
| 3.1 | 生命周期 skills 与第三方安全扫描 | 6 个 lifecycle skill；`skill-security-scan.test.mjs` | 已完成 |
| 3.2 | explore/implement/review 角色与工具隔离 | `roles.ts`；只读角色排除 write/bash/patch/todo；角色单测 | 已完成 |
| 3.2 | 子代理回传契约、超时与并行 explore | `subtask.ts`、`subtask-parallel.ts`；timeout timer 清理与并行测试 | 已完成 |
| 3.3 | browser_act 跨步会话 | fake session unit + 真实 Playwright `open → extract → close` 1/1 | 已完成 |
| 3.3 | 网络 guard 覆盖重定向/子资源 | BrowserContext route 测试证明 denied request abort | 已完成 |
| 3.5 | Mission 进度通知 | Telegram/Slack formatter 与 dispatch 测试；Slack `{ok:false}` 判错 | 代码完成，真实外部发送未验收 |
| 4.1 | 可选 LLM eval，默认 skip | `npm run eval:llm`: pass=0 fail=0 skip=2 | 已完成 |
| 4.1 | 启用路径真实 HTTP 请求 | 本地 HTTP server 测试验证 `/v1/chat/completions` 与精确 `QOK` | 已完成；真实 provider 未验收 |
| 4.2 | code_symbols 搜索与上下文护栏 | TS symbol 命中、文件预算和 10k 节点预算测试 | 已完成 |
| 4.3 | 可选 TS LanguageService | 默认关闭、definition/hover/symbols、越界拒绝、limit cap、文件刷新测试 | 已完成 |
| 4.4 | 依赖层文档和扫描 | `npm run dep:layers` 可运行；177 个 src 文件；19 条反向边基线 | 按 spec 完成，债务未清零 |

## 2. 新发现并已修复

1. 自定义 `QLING_TOOL_RESULT_MAX_CHARS` 小于默认 head/tail 时，摘要可膨胀到上限数倍；现已把提示文本纳入总预算。
2. explore/review 角色原先包含会写入 task 状态的 `todo`；现已移除。
3. Subtask 成功时 timeout timer 未清理；现由 `runWithTimeout()` 在 finally 中释放，并始终 shutdown。
4. browser_act 原先只检查初始 URL，重定向和子资源可绕过私网 guard；现由 context route 全请求拦截。
5. 首次 browser_act 导航失败会残留会话；现自动关闭新建会话。
6. Slack HTTP 200 + `{ok:false}` 原先误报 sent；现判为 error。
7. LSP 可读取 runtime roots 外绝对路径、结果 limit 无上限、文件更新可能读旧缓存；均已修复。
8. LLM eval 对 `/v1` base URL 会生成 `/v1/v1/chat/completions`，且 `QOK extra` 被误判成功；均已修复。
9. code_symbols 原生遍历只有代码文件上限，没有非代码目录节点预算；已增加默认 10,000 节点预算。
10. `docs/skills.md` 两处尾随空格导致 `git diff --check` 失败；已清理。
11. `npm pack` 同时触发 `prepack` 与 `prepare`，连续两次清空/构建 `dist`；已移除重复 `prepack`，保留单一 `prepare` 构建入口。
12. Memory Dream LLM 在环境变量缺失时默认开启；已改为仅显式 true/1/on/yes 开启。
13. 远程 discovery 忽略 unsigned 配置、network Guard 和响应边界；已改为 fail-closed、禁重定向、1 MiB 上限并校验 manifest。
14. Discovery metadata 工具被注入模型但没有执行器；已分离 metadata 与 executable tools，避免必然 `TOOL_NOT_FOUND`。
15. Workflow resume 未持久化 definition 且 runId 可包含路径；已持久化定义、校验安全标识符并明确拒绝不完整旧快照。
16. browser_act 无会话 goto 在 Guard 前启动浏览器；已把 URL 检查前移，拒绝目标不创建会话。

## 3. 新鲜验证证据

- `npm run ci:check`: exit 0；smoke 67 pass / 0 fail / 1 default skip；eval smoke 22/22 pass。
- 变更相关目标测试: 67/67 pass。
- 真实 browser_act Playwright E2E: 1/1 pass。
- `npm run eval:llm`（无开关/无 key）: 0 fail / 2 skip。
- `npm audit --audit-level=high`: 0 vulnerabilities。
- `git diff --check`: exit 0。
- 旧英文名称的三种大小写形式扫描: 无命中。
- 生产路径敏感串扫描: 无命中；三处全仓命中均为显式测试夹具。
- npm pack dry-run: `@qlingzzy/qling@1.0.0`，399.4 KB，解包约 1.5 MB，558 entries；无 `.env`、tests、`docs/superpowers`。
- npm pack lifecycle: `BuildCount=1`、`PrepareCount=1`、`PrepackCount=0`；打包后全局 npm-link CLI 仍返回 `qling/1.0.0`。
- 本机 npm-link CLI: `qling --version` 与 `node dist/index.js --version` 均为 `qling/1.0.0`。

## 4. 剩余边界

### GitHub 与 npm 边界

- 本报告覆盖提交前本地审计；GitHub 推送结果以最终远端 SHA 核对为准。
- 本轮只提交并推送 GitHub `main`，不发布 npm、不创建 release/tag。

### 已接受的架构债

- `dep:layers` 当前有 19 条 forbidden reverse edges；Phase 4 spec 明确本阶段只记录，不启用 strict。
- 远程 discovery 尚无公钥信任链，因此默认拒绝 unsigned；显式允许时仍经过 network Guard。manifest 工具仅作为 metadata，未绑定执行器前不注入模型工具列表。
- Workflow checkpoint 已持久化 definition 并校验 runId；缺失 definition 的旧 checkpoint 会明确拒绝恢复。

### 需要真实凭据/外部环境的验收

- DeepSeek/OpenAI 真实 provider 的 `eval:llm`。
- Telegram 与 Slack 的真实消息投递。
- daemon、Ollama 和可选 channel 配置；Doctor 当前以 warning 呈现，不是默认启动失败。

## 5. 发布建议

当前建议为 **Launchable with caveats**：计划内实现可提交并推送 GitHub；外部通知与 provider 真实验收可作为后续 release candidate 检查项，不阻塞默认 local-first 功能。npm 发布和 release/tag 不在本轮范围内。
