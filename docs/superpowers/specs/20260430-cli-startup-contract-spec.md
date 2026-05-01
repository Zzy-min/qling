# `qingling` 启动契约改造设计说明（默认 TUI + 全局命令优先）

## 目标
- 统一启动语义，消除 README 与实际行为不一致。
- 默认无参数进入流式 TUI。
- 保留 REPL 和单次执行能力，并定义清晰冲突规则。
- 全局命令（`npm link` / `bin`）默认可用，避免“先手动 build”。

## 启动契约（固定）
1. `--help` 优先级最高，输出帮助并退出 `0`。
2. 模式互斥：
   - 交互模式：`--tui` / `--repl`
   - 单次模式：`--once "<task>"` 或位置参数（`qingling "task"`）
3. 冲突报错：
   - `--repl` 与 `--tui`、`--once`、位置参数任意组合冲突。
   - `--tui` 与 `--once`、位置参数冲突。
   - 冲突统一：`Error: [CLI_INVALID_MODE_COMBINATION] ...`，退出码 `2`。
4. `--once` 缺少任务：
   - `Error: [CLI_MISSING_TASK] ...`，退出码 `2`。
5. 无参数默认进入 TUI（强制切换）。

## 分发与脚本
- `scripts`：
  - `start`: `node dist/index.js`
  - `tui`: `node dist/index.js --tui`
  - `repl`: `node dist/index.js --repl`
  - `exec`: `node dist/index.js --once`
- `prepare` + `prepack` 触发构建，保证全局命令安装后可运行。

## 验收标准
- `npm run build && npm test && npm run test:smoke` 全通过。
- 新增 CLI 启动矩阵测试（默认 TUI、help、repl/tui/once、冲突与退出码）。
