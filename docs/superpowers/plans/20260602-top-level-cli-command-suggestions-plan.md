# 顶层 CLI 命令错拼建议实施计划

## Phase 1 - RED Tests
- 在 `tests/unit/cli-startup.test.mjs` 增加解析层测试：
  - 英文错拼 `expors` 返回 `CLI_UNKNOWN_COMMAND_SUGGESTION`；
  - 中文错拼 `导出列` 返回 `CLI_UNKNOWN_COMMAND_SUGGESTION`；
  - 多词任务 `修复 bug` 和弱匹配 `zzzzzz` 不被拦截。
- 在 `tests/smoke/cli-startup.smoke.test.mjs` 增加进程级测试：
  - `node dist/index.js expors` 退出码 `2`；
  - 输出包含建议和 help 提示；
  - 不泄露环境密钥。
- 运行 `npm run build` 后执行目标测试，确认新增测试先失败。

## Phase 2 - Implementation
- 在 `src/cli/startup-contract.ts` 增加本地候选表，覆盖英文顶层命令和中文别名。
- 实现轻量归一化、编辑距离、候选评分和格式化错误消息。
- 在位置参数 fallback 前插入高置信单词拦截，弱匹配保持原行为。
- 扩展 `CliResolutionErr.code` 类型，保持 `formatCliError` 通用输出。

## Phase 3 - Verification
- 运行目标单测与 smoke：
  - `npm run build`
  - `node --test tests/unit/cli-startup.test.mjs tests/smoke/cli-startup.smoke.test.mjs`
- 最后运行 `npm run ci:check`。

## Risk Controls
- 只拦截单个位置参数，避免影响自然语言多词任务。
- 阈值必须高于弱匹配，避免把普通任务误判为命令。
- 错误消息提供 `qingling run "<task>"` 逃生口，兼容有意执行单词任务的用户。
