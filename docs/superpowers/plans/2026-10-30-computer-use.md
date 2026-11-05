# Qling Computer Use Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task. 本轮由主代理执行，独立审查只读；不自动提交、安装驱动、控制桌面或调用付费模型。

**Goal:** 为 Qling 接入默认关闭、后台优先、按动作审批的本地 Computer Use 工具。

**Architecture:** TypeScript 控制器持有每个 Agent 的独立目标/快照状态；现有 MCP stdio 客户端增加原始结果和隔离环境选项，适配用户显式指定的 Cua Driver。复用权限流水线、取消信号、artifact 和关闭生命周期，不引入第二个 Agent 循环。

**Tech Stack:** Node 22、TypeScript、现有 MCP JSON-RPC、node:test，无新增依赖。

**Spec:** 用户批准的 `C:/Users/Lenovo/Hermes-ComputerUse-开发流程.md`。该文档中的运行态和驱动内部机制仅作为历史证据，不视为当前机器实测。

## 开源依据（2026-10-30 读取）

- [Cua Driver](https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md)：以 `cua-driver mcp` 为运行时边界、协商真实工具 schema；不捆绑驱动、模型或额外许可证组件。
- [Hermes input adapter](https://github.com/NousResearch/hermes-agent/blob/main/tools/computer_use/cua_backend_input.py)：显式 pid/window_id、element_index 优先、后台投递、传输不确定时不自动重放。
- [Microsoft UFO](https://github.com/microsoft/UFO)：UIA + 视觉、GUI + API；Qling 继续保留网页 browser_* 与原生桌面的分工。
- [Anthropic computer-use demo](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo)：低权限/隔离、明确风险、重要副作用人工确认。
- [OSWorld](https://github.com/xlang-ai/OSWorld)：后续真实验收采用独立结果检查；本批的模拟驱动结果不代表 OSWorld 成绩。

## Global Constraints

- 默认 `QLING_FEATURES_COMPUTER_USE=false`；驱动必须由操作者指定绝对路径，不搜索/安装/下载可执行文件。
- 模型不能设置驱动路径、argv、环境变量或运行任意驱动工具；只允许冻结的动作映射。
- 所有桌面数据是不可信数据，不从窗口文字导入授权或指令。
- 第一期后台操作；拒绝 foreground/focus_app，不自动升级焦点或权限。
- pid/window 必须显式捕获；输入必须携带当前 snapshot_id，每次输入后立即失效，必须重新捕获。
- 输入均通过 Qling 审批；auto 模式也不能默默放行。会话 grant 不得从 capture 扩张到 click/type。
- 原生输入的传输超时/断线/取消结果为 unknown_outcome，不重放；失效快照并关闭连接。
- 截图本地保存、最多 8 MiB/帧；正文/图像不写诊断日志；不自动发给视觉模型。
- 保留旧 MCP 调用接口行为，新增 raw API 不把图像转换成正文。

## Review Focus

1. 旧快照、目标切换、并行请求导致错窗：单会话串行，一次性快照，run/session 隔离测试。
2. capture 授权被复用为输入授权：动作分类、Plan 硬拒绝输入、拒绝复用 computer_use grant。
3. 断线后重复点击或输入：模拟丢响应，必须 unknown_outcome 且驱动收到一次调用。
4. 驱动假成功/错误 verdict：只转发结构化判定，缺失时 unverifiable，不宣称任务成功。
5. 环境凭据或截图泄漏：完整替换子进程环境、输出大小限制、仅本地 artifact；测试带假密钥环境。

## Task 1：协议与状态控制器

Files: `src/computer-use/{schema,controller}.ts`；`tests/unit/computer-use.test.mjs`。

Interfaces: `ComputerUseController.execute(args, signal?): Promise<ToolResult>`，`close():Promise<void>`；依赖 `ComputerUseDriver.connect/call/close`；action 参数严格白名单，不直通额外属性。

- [ ] RED：无 capture 输入、过期 snapshot、错窗、后台失败不升级、断线不重放、相同截图去重最多两次、key 别名阻断、两个控制器隔离。
- [ ] GREEN：支持 list_windows、capture、click/double_click/right_click/middle_click、scroll、type、key、set_value；不支持的动作明确拒绝，不假实现 drag/focus。
- [ ] 工具结果 JSON 含 verdict/next action；捕获树 bounded；图像只返回本地 artifact 元信息，不内联 base64。

## Task 2：受限 MCP 驱动与完整生命周期

Files: `src/computer-use/driver.ts`，`src/mcp/{types,client,stdio-transport}.ts`；`tests/unit/computer-use-driver.test.mjs` 和本地模拟 stdio 驱动。

- [ ] RED：原始 structuredContent/images 保留、子进程不收到假 API key、missing schema 拒绝、cancel/timeout 关闭、不重复输入。
- [ ] GREEN：`MCPClient.callToolRaw`、环境完整替换和接收字节上限；当前 schema 探测能力，拒绝未支持参数，不依赖包版本猜测。
- [ ] 错误信息不包含驱动原始输出、密钥或截图；模拟驱动不控制真实桌面。

## Task 3：工具/权限/配置接入

Files: `src/tools/index.ts`，`src/runtime-services.ts`，`src/agent-loop.ts`，`src/config.ts`，`src/pipeline/hooks.ts`，`src/guard/permission-grants.ts`，`src/harness/tool-capability.ts`。

- [ ] RED：默认不曝光；开启后可调用；Plan 只允许观察；输入即使 auto/remembered grant 也要求确认；shutdown 关闭驱动；取消传递。
- [ ] GREEN：每个 dispatcher/controller 独立；安全策略在 pipeline 生效，controller 自身仍做目标/键位/快照检查；不赋予子代理桌面工具。
- [ ] 配置 `features.computer_use` 与 `computer_use.driver_path`；自动启动仅在首次显式工具调用。

## Task 4：验收和交付

- [ ] 定向测试、build、全量 unit、相关 smoke、packaging、strict layers、diff check；并发失败单列，不能用 focused rerun 冒充全部通过。
- [ ] 文档说明启用方法、架构来源、截图敏感性、已实现动作和限制；不声称跨平台/Windows 真实验收已完成。
- [ ] 后续阶段：显式前台升级与恢复焦点、drag、模型原生图像消息、录制与脱敏回放、隔离计算器/记事本真实验收、OSWorld 适配。未完成部分不计为本批完成。

## 执行记录与裁决

- Ruling：用户要求“开始实现”，本轮完成 TypeScript 适配基座与十类后台动作，不把全文原生驱动重写或未完成的真实桌面验收算作本批交付。前台、drag、录制、原生多模态回灌保持未实现。
- Ruling：在已有 `codex/agent-reliability-v3` 工作区增量实现，保留历史未跟踪资料；无自动 commit/push。基础为 `cc936d4`。
- Task 1：控制器原始 8 例 RED→GREEN；追加错窗/关闭/重连/native snapshot/中文和键位兼容覆盖。截图用现有 artifact store，不扩大 Message.content 公共类型。
- Task 2：真实子进程模拟 MCP 的 raw/image/env/abort/drop/schema/close/UTF-8 回归；未控制真实应用。复用 MCP transport，默认旧 MCP 行为保持；新驱动显式禁用环境继承和 stderr 正文。
- Task 3：默认曝光、auto/grant、Plan、危险键位、dispatcher lifecycle 六项 RED→GREEN；子代理角色白名单不增加 desktop 权限。
- 独立审查发现的两个关闭竞态均已补 RED→GREEN；driver epoch、controller close-after-await 以及 native snapshot 与连接代次绑定完成。复查未发现新增高风险。
- Ruling：`computer-use/schema.ts` 为 foundation（纯契约）；其它 Computer Use 模块与现有工具执行同属 agent-runtime，不依赖 CLI/UI。严格分层通过。
- 只读本机驱动基线验证：版本 0.21.0 与文档 SHA 一致，manifest/describe 可读；双击工具不接受 button，已按真实 schema 修正并补回归测试。没有启动桌面动作。
- Task 4：默认关闭路径 Smoke 76 pass / 0 fail / 2 skip（browser_act opt-in 与真实 portable ZIP 缺失）；全量 unit、分层和包装结果以本轮最终测试输出为准。
- 最终验收：29 项新增 Computer Use 回归均包含在全量单测中；全量 1608 total / 1607 pass / 0 fail / 1 skip。构建、strict layers（0 reverse edges）、packaging 和 diff check 通过。最后双击参数修正由定向 RED 和最新全量单测验证；先前完整 Smoke 验证默认关闭兼容路径，不宣称真实桌面 E2E 通过。
- 后续用户授权的真实计算器验收：六次后台点击执行 `17 × 23 = 391`，每步新 capture 的 UIA 显示符合预期，最终截图视觉核对通过；六次均触发审批检查，由固定动作验收程序放行，未测试 TUI 审批控件。动作 verdict 为 unverifiable，因此依据捕获而非调用返回判断成功。零模型调用、零前台回退，连接关闭。首个窗口消失时输入前停止，重新发现新目标后单独验收；不复用旧句柄。其它应用、最小化/遮挡、模型规划和跨平台仍未验收。
