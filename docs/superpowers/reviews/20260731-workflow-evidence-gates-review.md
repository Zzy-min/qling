# 轻灵流程证据门禁与运行状态收口复查

## 结论

本次范围已实现并通过定向验证。基座提示词不再允许用文档或 Skill 描述替代本机当前状态证据；成功 Agent 运行会在返回前清除恢复状态，因此后续会话快照不会继续记录 `running`。

## 变更核对

- `src/pipeline/sections.ts`
  - 区分文档能力、当前运行态和任务结果。
  - 当前状态结论要求本轮直接证据。
  - 对相关工具主动执行安全只读预检。
  - OpenCLI 增加 `list -f json`、`doctor`、站点帮助和 `whoami` 门禁。
  - 最终答复前要求“声明 → 证据”核对。
  - 明确临时文件清理仍属于删除。
- `src/execution/recovery-controller.ts`
  - 新增 `completeRun`：成功清除恢复态；失败、耗尽、取消写入终态。
- `src/agent/main-loop.ts`
  - 所有非暂停出口同步调用恢复状态收口。
  - `paused` 路径保持原样，继续支持 `/recover`。

## 验证证据

- RED：新增测试最初 28/31 通过，3 项按预期失败。
- GREEN：定向测试 31/31 通过。
- Dashboard 组件测试 1/1 通过。
- TypeScript 与 Dashboard 构建通过。
- 完整单元测试 1067/1067 通过。
- 并发 smoke 总门禁为 71 通过、3 失败、2 跳过；失败均为子进程超时或空输出。
- 三个失败文件串行复验：
  - `cli-run-shutdown.smoke.test.mjs`：3/3 通过。
  - `knowledge.smoke.test.mjs`：3/3 通过。
  - `repl-shutdown.smoke.test.mjs`：1/1 通过。
- `eval-smoke`：22/22 通过。
- `eval-tasks`：10/10 通过。
- anchored edit：16/16 正确，错误写入 0。
- packaging：通过，版本 1.3.1。
- dependency layers：禁止反向依赖 0。
- `git diff --check`：通过，仅有 Windows 行尾提示。

## 风险与边界

- `npm run ci:check` 的单次聚合命令未取得全绿退出码，因为并发 smoke 的三个子进程时序失败；串行复验表明它们不是稳定的功能回归，但不能将该聚合命令表述为“已通过”。
- 本轮没有提交、推送、发布、删除或清理文件。
- 工作树中既有 Dashboard/TUI 改动保持不变，本次只增量修改流程与恢复状态相关文件及测试、规格文档。
