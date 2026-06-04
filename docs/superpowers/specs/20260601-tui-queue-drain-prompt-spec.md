# TUI 队列完全空闲后恢复 prompt 规格（2026-06-01）

## 背景

TUI 输入已通过 `SerialInputQueue` 串行处理，状态线也能显示队列运行态。当前每个 `handleUserInput()` 在自己的队列项完成后都会尝试恢复 prompt；如果用户在长任务期间连续提交多条输入，第一条完成时第二条可能已经开始执行，导致终端出现中间 prompt。

## 目标

- 多条输入排队时，只在整个队列完全 drain 后恢复 prompt。
- 队列仍在处理或仍有 pending 输入时，不恢复 prompt。
- 最终 prompt 使用空闲状态线，不残留 `queue=run/<max>` 或 `queue=<pending>/<max>`。
- 不暴露输入正文，只使用本地队列元数据判断是否恢复 prompt。

## 非目标

- 不改变输入串行顺序。
- 不取消正在运行的输入。
- 不新增持久化、联网或模型调用。

## 验收

- 单测覆盖两条输入并发提交时，中间不恢复 prompt，最终只恢复一次。
- 单测覆盖最终 prompt 状态线不含 `queue=`。
- TUI 退出 smoke 和 `npm run ci:check` 通过。
