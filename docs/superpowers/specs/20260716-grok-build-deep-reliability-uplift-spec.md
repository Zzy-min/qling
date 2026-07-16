# 轻灵 × Grok Build 深度可靠性升级规格

## 目标

在不破坏现有 CLI、Headless JSON v1 和事务性 `patch` 的前提下，按以下顺序提升轻灵：

1. 稳定 Prompt 前缀，并为合成消息建立可持久化来源标记。
2. 使用统一上下文预算与确定性压缩失败语义。
3. 为 MCP 提供可选按需工具目录、字节级输出上限、重复调用事件和完整成本语义。
4. 补齐子代理 usage、角色校验与后台生命周期。
5. 以默认关闭的方式引入锚定编辑和 JSON Hooks。

## 兼容与安全约束

- 旧配置缺少新增字段时保持现有行为；MCP 默认继续 eager 暴露。
- Headless `schemaVersion` 保持 `1`，新增内容只能是可选字段。
- 现有 `read` / `patch` 不改变协议；锚定编辑使用独立实验工具。
- 不把 API Key、endpoint、缓存目录、状态目录或用户绝对路径写入模型 Prompt。
- 新增索引、账本、Hook 日志和状态快照只写本地状态目录。
- 外部 telemetry、ACP 和插件远程市场不在本轮强制交付范围。

## 行为契约

### Prompt 与合成消息

- system prompt 只包含稳定策略与静态 section；环境与动态检索内容以带 `synthetic_reason` 的 user 消息注入。
- 合成消息按 `reason + synthetic_key` 去重，恢复会话不得重复注入。
- inspect 能看到静态 Prompt 哈希以及 static/runtime/dynamic 三层长度。

### 压缩

- 已知窗口按 85% 触发；未知窗口使用兼容阈值 6000。
- 摘要器由当前 provider 回调提供，不再直接调用固定 DeepSeek 地址。
- 摘要无效时不得写入错误占位符；压缩失败保留原消息并抑制本轮自动重试。
- 压缩结果保留最后真实用户请求、完整最近工具链和确定性状态消息。

### 工具、成本和子代理

- `mcp.tool_exposure=search` 时只向模型暴露 `search_tool` / `use_tool`；目录检索失败回退 eager。
- MCP 输出最多 20 KiB UTF-8，截断信息写入 `ToolResult.meta`。
- 同签名工具超限只产生一次 `loop_detected`，并进入既有 repeated_action 恢复路径。
- 成本内部使用整数 tick；数据不完整时省略成本并显式标记 partial/incomplete。
- 未知子代理角色结构化失败，不得获得 implement 写权限。

### 实验编辑与 Hooks

- `read_anchored` 输出文件版本与逐行锚点；`patch_anchored` 写前原子校验，歧义或版本冲突不写盘。
- 锚点最多在原行上下 15 行恢复，必须唯一匹配。
- JSON Hooks 支持 SessionStart/End、PreToolUse、PostToolUse、PostToolUseFailure；默认关闭。

## 验收

- 定向单测覆盖上述协议与失败路径。
- `npm run build`、`npm run ci:check`、`node scripts/eval-recovery.mjs`、`git diff --check` 通过。
- MCP 目录基准在 100 工具样本中减少至少 80% 初始 schema 字符量，Top-5 查询命中率至少 90%。
- 锚定编辑不得发生错误写入；未达到收益阈值时保持实验状态。确定性对比门禁：`npm run eval:anchored`（20 fixtures，要求相对 `patch` 提升至少15个百分点且错误写入为0）。当前基线为普通 `patch` 50%、`patch_anchored` 100%、提升50个百分点、错误写入0；脚本输出是权威结果。
