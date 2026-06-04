# 顶层 `status/help` 本地基础交互实施计划（2026-06-01）

## Step 1: 测试先行

- 新增 `tests/unit/local-status-report.test.mjs`：
  - 输出本地状态摘要。
  - sessions/exports 只按文件元数据计数。
  - endpoint/API key 脱敏，正文 secret 不泄露。
  - 缺失目录降级为 0。
- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `status` 顶层模式可解析。
  - `状态` 中文别名可解析。
  - `help` 与 `帮助` 输出 help mode。
  - help 文本展示 `qingling status`、`qingling help` 与中文别名。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - `node dist/index.js status` 输出本地状态并退出，且不泄露 secret。

## Step 2: 状态报告模块

- 新增 `src/local-status-report.ts`：
  - 汇总 config、workspace/state/cache、git branch、sessions/exports 计数、permission、MCP、hooks。
  - 只读目录项和文件扩展名，不读正文。
  - 复用 endpoint 脱敏与 MCP/hooks 汇总逻辑。

## Step 3: CLI 接入

- 在 `src/cli/startup-contract.ts` 增加 `status`、`help` 与中文别名。
- 在 `src/index.ts` 的 AgentLoop 实例化之前处理 `decision.mode === "status"`。
- 更新 help。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/local-status-report.test.mjs" "tests/unit/cli-startup.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
