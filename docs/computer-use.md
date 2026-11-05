# Computer Use（第一批实验实现）

Qling 使用单个 `computer_use` 工具通过 MCP stdio 连接操作者指定的本地 Cua Driver。默认关闭，不下载、安装、捆绑或自动查找驱动，不接管浏览器现有登录资料，不引入第二套 Agent 循环。

## 当前范围

已接入：`list_windows`、`capture`、`click`、`double_click`、`right_click`、`middle_click`、`scroll`、`type`、`key`、`set_value`。

未实现：drag、foreground/focus_app、恢复前台焦点、整桌面坐标寻址、录制/重放、自动图像缩放、原生图像消息自动回灌模型。已完成下述 Windows 计算器单例验收；尚未完成其它应用、macOS/Linux、OSWorld 或真实模型的端到端验收。模拟驱动测试只证明 Qling 契约和安全边界，不证明驱动后台操作在某个应用中一定有效。

网页仍优先使用 `browser_*`；桌面工具不是网页权限或 Bash 权限的替代通道。截图和可访问性树可能包含敏感信息；不要在含凭据、私人聊天或支付界面的桌面上直接做首次验收。

## 显式启用

操作者先自行核对并安装可信的 [Cua Driver](https://github.com/trycua/cua/tree/main/libs/cua-driver)。Qling 不运行安装脚本，也不放宽系统权限。使用绝对路径指向已有可执行文件，仅在明确授权桌面任务后启用。

PowerShell（以下驱动路径是示例，不表示本机已有此文件）：

```powershell
$env:QLING_FEATURES_COMPUTER_USE = 'true'
$env:QLING_COMPUTER_USE_DRIVER_PATH = 'C:\Tools\Cua\cua-driver.exe'
qling chat
```

也可在自己信任的 Qling 配置中设置：

```yaml
features:
  computer_use: true
computer_use:
  driver_path: 'C:\Tools\Cua\cua-driver.exe'
```

首次 `computer_use` 调用才会启动该二进制，参数固定为 `mcp`；模型不能替换路径、argv 或环境变量。使用独立 stdio 会话和精简环境，去除模型密钥、认证 Token 与 Node 注入变量；不传入 existing-profile grant 或 bypass 参数。驱动权限模式为 standard，但它不是 OS 沙箱；Qling 的逐次审批不能替代驱动自身的权限实现。

## 标准交互

1. `computer_use action=list_windows` 获取窗口列表。
2. 显式选定 `pid` 和 `window_id` 后执行 `capture`（最多 200 个元素，默认 100）。不模糊匹配应用，不回退到前台或其它窗口。
3. 读取返回的元素和 Qling `snapshot_id`，用 element 寻址输入。例如：

```json
{"action":"click","element":12,"snapshot_id":"<capture 返回的 ID>"}
```

4. 每次输入都需要人工确认，包括 auto 模式；会话 remembered grant 不可跨动作复用。Plan Mode 只允许观察。显式权限 deny 仍优先。
5. 输入前消费快照；成功、拒绝、不确定结果之后均应重新 capture。缺少 native snapshot 的驱动只可观察，不能据此授权元素输入；重连、切换 run/session、关闭都会使快照失效。
6. 返回的 `confirmed` 只是驱动报告，不是整个用户任务的外部验收。`unverifiable` 要重新观察；`background_unavailable` 不自动升级前台；`unknown_outcome` 不能原样重放输入，先人工确认状态再决定后续动作。

`type` 必须指向当前快照中可用的 element；WinUI 输入可优先 `set_value`。坐标只在驱动明确提供窗口尺寸并接受相应参数时使用，不做屏幕/窗口/缩放坐标的隐式换算。

捕获结果分别返回 `element_input_available` 与 `coordinate_input_available`；`input_available` 表示其中至少一种可用，不代表元素树非空。驱动的 `degraded`、`degraded_reason` 和 `elements_complete` 会保留，属于不可信观察，不能扩大授权。空树不证明 Windows 没有 UIA，也不要求用户反复重启应用。

坐标能力仅在本次 PNG 的 IHDR 尺寸与驱动 `screenshot_width/height`（兼容 `width/height`）一致时开放。先由已获授权的图像读取器检查该次截图，再使用窗口内 PNG 像素坐标和当前一次性 snapshot；禁止猜测、使用桌面坐标或未经换算的缩放预览坐标。无法读取图片或定位不明确时停止。仍逐次审批、后台投递且禁止自动重放；本工具不会自动把截图发给模型。

## 快照、图像与隐私

- 屏幕文字属于不可信数据，不能产生新的用户授权。
- PNG 单帧最多 8 MiB，超限或错误格式拒绝；MCP 接收缓冲最多 16 MiB。未自动缩放至 1456 像素，不能宣称已完成文档 Phase 6。
- 图像保存到 Qling state 的内容寻址 artifact，工具文本只包含 hash/path/mime/bytes，不含 base64；同一 run/目标/图像最多连续省略两帧，第四帧重新给出 artifact。
- 不自动调用视觉模型。需要时用户可单独授权 `vision_analyze` 读取 artifact；会产生模型请求且可能把截图发送到所配置服务。
- 工具说明、结果和窗口文字仍可能进入普通会话历史。不要输入密码/支付凭据；本批不是内容无关轨迹录制系统，也未实现截图过期清理。Qling state 是敏感数据，应按本地权限保护。
- 危险键位含别名/额外修饰键硬阻断；这不等于检测所有 GUI 危险语义，发送、删除、支付等影响必须由人工审查输入目标与动作。

## 契约兼容与错误

不凭包版本猜测能力，按连接后的实际 `tools/list` schema 校验工具名、参数名、必需字段和枚举。只使用固定工具映射；缺少后台能力或 snapshot 参数即返回 `CAPABILITY_UNSUPPORTED`，不会尝试其它工具/CLI/前台回退。当前只支持 MCP structuredContent 或 JSON 文本的结构化元素；旧驱动纯 Markdown 树解析、element_token 兼容与更多驱动版本留待后续适配。

文档给出的 0.20/0.21 版本是历史参考。本批不额外执行 `manifest` 子进程，也不把其自述或 API 导入表当成 Windows 后台行为的证明。

## 实现来源与验收层次

2026-10-30 本机驱动核对：已安装 Cua Driver 0.21.0，SHA-256 `94216fd10a101a165efb94e1c30e6ed05e3947ae7140f096b3545b8bdae580da`，与用户文档一致。先只读运行 `manifest` 和 `describe`，核对 MCP 入口、snapshot_id、background 参数和双击 schema（不传单击专用 button）；随后经用户授权执行计算器验收，未修改驱动权限。

### Windows 计算器单例验收（2026-10-30）

- 使用实际构建的 Qling dispatcher、权限流水线、控制器与 MCP 驱动，执行 `17 × 23 =`，六次后台点击后显示 `391`；每次输入后重新 capture，逐步核对 UIA 显示，最终截图人工式视觉检查一致。
- 六次输入均触发审批检查（即使 auto 模式）；验收程序只对已授权的固定计算器动作放行。这不代表 TUI 审批控件已端到端验收。
- 驱动动作均返回 `unverifiable`，未将调用成功当作任务成功；以上结果由后续捕获证明。零模型调用、零前台回退，结束时关闭本次 Qling 驱动连接，未持久启用功能。
- 首次目标窗口消失时，程序在输入前停止；重新发现新窗口后另起验收，未复用旧句柄或盲目重放。
- 仅证明该计算器实例的六个点击与捕获路径；最小化/遮挡、其它输入类型、真实模型规划、TUI、取消/崩溃及跨平台仍须分别验收。本地报告和截图不纳入 Git。

- [Hermes](https://github.com/NousResearch/hermes-agent/tree/main/tools/computer_use)：单工具、显式目标、后台优先、动作结果与不重放边界；本实现为 TypeScript 原创适配，不复制 Python/Rust 文件。
- [Cua Driver](https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md)：本地 MCP 运行边界和真实能力协商。这里只使用驱动接口，不引入 OmniParser/模型包或其它许可证组件。
- [Microsoft UFO](https://github.com/microsoft/UFO)：结合结构化 UIA 与截图，保留原生桌面/网页/API 分工；本批以可访问性树为主。
- [Anthropic 示例](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo)：低权限隔离、敏感操作确认和截图成本意识。不移植其 Docker/Claude 专用循环。
- [OSWorld](https://github.com/xlang-ai/OSWorld)：后续以独立结果检查验收，不以 Agent 总结或调用成功代替任务成功。

后续真实验收建议先在隔离的计算器/记事本测试窗口验证 capture→输入→capture：窗口身份、最小化后台行为、中文输入、取消、驱动崩溃和重复副作用。先授权测试应用与允许动作，再运行；不得顺带读写其它应用或已登录浏览器。

### 空元素树修复验证（2026-10-30）

真实可见 CalculatorApp 窗口的驱动原始结果已有 `elements: []`、`ax_tree_empty` 和 640×1064 PNG，因此不是 Qling 丢失元素。修复 Qling 丢失降级说明、未识别原生截图尺寸的问题后，同一现场捕获返回 `element_input_available: false`、`coordinate_input_available: true`。此项只证明真实捕获与能力报告；不等于坐标点击、视觉模型规划或完整任务已经验收通过。
