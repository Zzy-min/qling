# `qingling` REPL 退出挂起修复设计（2026-05-01）

## 背景
- 当前 `src/repl.ts` 在 `q/quit/exit` 分支仅关闭 readline，不关闭 Agent 运行时。
- `AgentLoop` 默认启动 WAL projection worker（定时器），导致 REPL 命令退出后进程仍有活跃句柄，无法自然退出。

## 目标
1. REPL 退出命令触发后，确保调用 `agent.shutdown()` 清理 runtime 资源。
2. 保持现有 REPL 交互行为与命令兼容。
3. 增加自动化回归测试，确保该行为持续受保护。

## 方案
1. 在 `src/repl.ts` 的退出分支执行顺序改为：
   - 打印退出提示
   - `await agent.shutdown()`（使用 try/catch 防止清理异常阻断退出）
   - `this.rl.close()`
   - `return`
2. 新增 smoke 测试：启动 `qingling repl` 子进程，输入 `exit`，要求在限定时间内自然退出。

## 验收
- `npm run ci:check` 全通过。
- 新增 smoke 用例可在未 kill 子进程情况下通过。
