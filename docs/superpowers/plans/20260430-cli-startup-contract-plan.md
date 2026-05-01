# `qingling` 启动契约改造实施计划

## Step 1: CLI 解析与分流
- 在 `src/index.ts` 引入显式解析逻辑：
  - 支持 `--help` / `--tui` / `--repl` / `--once`.
  - 保留位置参数单次执行。
  - 落地互斥冲突校验与统一错误码。
- 默认无参数进入 TUI。

## Step 2: 脚本与分发
- 更新 `package.json` scripts：新增 `tui/repl/exec`。
- 增加 `prepare` 与 `prepack` 指向 build。

## Step 3: 文档同步
- 更新 README 运行章节：
  - 全局命令优先示例
  - npm scripts 等价入口
  - 强制切换迁移说明

## Step 4: 测试与门禁
- 新增 `tests/unit/cli-startup.test.mjs` 覆盖启动矩阵和冲突退出码。
- `tests/smoke` 增加 CLI 启动契约 smoke。
- 运行：`npm run build`、`npm test`、`npm run test:smoke`。
