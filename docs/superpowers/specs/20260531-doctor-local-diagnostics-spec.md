# `qingling` 稳定体验：本地 `/doctor` 诊断规格（2026-05-31）

## 背景

目标是朝 Claude Code 的丝滑交互体验落地，同时追求稳定、数据留存本地。当前已有 `/statusline` 提供运行态可见性，但缺少一个可解释的本地自检入口来判断环境、数据目录、会话与后台能力是否健康。

## 目标

- 新增 `/doctor` slash command 与中文别名 `/诊断`。
- 输出本地诊断报告，覆盖：
  - Node runtime
  - workspace 是否存在
  - git 分支或非 git 工作区
  - 本地 state/cache 目录
  - 当前 session id
  - 权限模式
  - daemon 健康状态（只探测本机 loopback，失败不阻塞）
- 所有检查只读取本地状态或本机 loopback，不上传数据。
- 诊断结果使用 `pass/warn/fail`，便于用户快速判断稳定性风险。

## 非目标

- 不执行修复动作。
- 不运行完整测试套件。
- 不访问公网。
- 不写入新的持久化诊断日志。

## 验收

- 单测覆盖健康报告汇总、缺失 state/cache 目录降级、daemon 异常降级。
- Slash command 单测覆盖 `/doctor` 和 `/诊断`。
- `npm run build` 通过。
- `node --test "tests/unit/doctor.test.mjs" "tests/unit/slash-commands.test.mjs"` 通过。
- `npm run ci:check` 通过。
