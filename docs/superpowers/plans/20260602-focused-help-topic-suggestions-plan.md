# 聚焦帮助主题错拼建议实施计划

## Phase 1 - RED Tests
1. 在 `tests/unit/help-topics.test.mjs` 增加：
   - CLI 英文错拼 `expors` 建议 `exports`；
   - CLI 中文错拼 `导出列` 建议 `exports`；
   - slash 英文错拼 `expors` 建议 `/help exports`；
   - 弱匹配 `zzzzzz` 不展示建议。
2. 在 `tests/smoke/cli-startup.smoke.test.mjs` 增加：
   - `node dist/index.js help expors` 退出 `0`；
   - stdout 包含建议与 usage；
   - stdout/stderr 不泄露测试密钥。
3. 运行目标测试，确认新增断言先失败。

## Phase 2 - Implementation
1. 在 `src/help-topics.ts` 内基于 `TOPICS` 和 `aliases` 构建本地主题候选。
2. 用 code point 级相似度进行高置信匹配，阈值与顶层 CLI typo 建议保持同一量级。
3. 在未知主题 fallback 中按 surface 输出建议：
   - CLI: `qingling help <topic-id>` 和 `Usage     : <cliUsage>`；
   - Slash: `/help <topic-id>` 和 `Usage     : <slashUsage>`。
4. 保持精确 topic 输出路径不变。

## Phase 3 - Verification
1. `npm run build`
2. `node --test tests/unit/help-topics.test.mjs tests/smoke/cli-startup.smoke.test.mjs`
3. `npm run ci:check`

## Risk Controls
- 不改变 parser 错误码或 help 退出码。
- 不读取 `.qingling` 运行态文件，避免把帮助建议和私密本地数据耦合。
- 弱匹配不输出建议，降低误导率。
