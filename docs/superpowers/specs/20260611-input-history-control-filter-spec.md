# Input History Control Filter Spec

## 背景

TUI 输入历史用于让用户快速回到真实任务提示。当前 `StreamingREPL.handleQueuedUserInput()` 在识别退出命令、slash 命令之前就调用 `appendInputHistory()`，导致 `exit`、`/queue status`、`/sessions` 等本地控制输入也进入历史。后续按上箭头时先看到这些控制命令，会降低交互顺滑度。

## 目标

- 退出命令 `q`、`quit`、`exit` 不写入本地输入历史。
- slash 控制命令不写入本地输入历史，包括 `/queue status`、`/sessions` 等。
- 真实用户提示仍写入本地输入历史，并继续保留去重、敏感信息过滤和最大长度限制。
- 历史文件仍是本地 `input-history.json`，不新增远端或模型行为。

## 非目标

- 不改变 `InputBuffer` 的历史导航行为。
- 不改变 slash 命令本身的执行结果。
- 不迁移或清理已有历史文件中的旧控制命令。

## 验收标准

- smoke 测试证明 `exit` 触发退出但不创建/写入历史。
- 单元测试证明 `/queue status` 不进入历史，也不被当作 agent prompt。
- 单元测试证明普通 prompt 仍写入历史。
- 现有敏感输入过滤测试保持通过。
