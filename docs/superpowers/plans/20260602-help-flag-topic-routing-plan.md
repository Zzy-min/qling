# Help Flag Topic Routing Implementation Plan

## Phase 1 - RED Tests
1. 在 `tests/unit/cli-startup.test.mjs` 增加解析断言：
   - `--help exports` 保留 topic；
   - `exports --help` 聚焦到 `exports`；
   - `导出列表 -h` 聚焦到 canonical `exports`；
   - `expors --help` 保留 typo token；
   - 现有 `--help --repl --once x` 不带 topic。
2. 在 `tests/smoke/cli-startup.smoke.test.mjs` 增加：
   - `node dist/index.js --help exports` 输出聚焦帮助；
   - `node dist/index.js exports --help` 输出聚焦帮助；
   - 两者不泄露测试密钥。
3. 运行目标测试确认 RED。

## Phase 2 - Implementation
1. 在 `src/cli/startup-contract.ts` 中添加 `isHelpFlag` 与 help topic 提取 helper。
2. `hasHelp` 分支根据当前解析上下文选择 topic：
   - 已解析本地管理命令时使用 canonical mode；
   - 否则使用 positional token。
3. 在管理命令返回前识别 `subArgs` 内的 help flag，将 `command --help` 转成 help mode。
4. 保持纯 help 与模式冲突兼容行为不变。

## Phase 3 - Verification
1. `npm run build`
2. `node --test tests/unit/cli-startup.test.mjs tests/smoke/cli-startup.smoke.test.mjs`
3. `npm run ci:check`

## Risk Controls
- 不改变 `run/chat/repl` 任务执行路径。
- 只在帮助 flag 存在时改路由，避免影响正常管理命令参数。
- 聚焦帮助仍由本地静态 help topic 表提供。
