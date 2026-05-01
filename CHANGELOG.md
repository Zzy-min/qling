# Changelog

## v0.1.0 (2026-05-01)

### Phase 0 — Foundation

- 统一配置平面（CLI > ENV > config > defaults）
- 运行模式（run/chat/repl 子命令 + 旧入口兼容）
- 目录根与路径别名（workspace_dir/file_cache_dir/file_state_dir）
- Guard M1（URL 白名单、私网拦截、脱敏、审计日志）
- url_fetch 工具
- 错误语义升级（code/message/retriable/category）

### Phase 1-2 — Stability

- search 回归用例（limit 截断/context 差异/glob 过滤/Windows 路径）
- context-compactor 回归用例（tool_call 链保护/recentKeep 边界/孤儿 tool 保留）
- agent-loop 最小回合 smoke
- 统一错误语义（Error: [CODE] message）
- 输入边界校验（search/read/write/bash 全覆盖）
- 轻量可观测指标（per-turn 工具数/失败率/压缩次数/重试次数）

### Phase 3 — Memory

- 三层记忆架构（Scratchpad → Conversation → Persisted）
- WAL 追加日志（JSONL + 序列号 + 校验和）
- 投影 Worker（后台回放 + checkpoint）
- 崩溃恢复（WAL 重放）
- 记忆压缩（去重 + 过期 + 上限裁剪）
- LLM 增强记忆提取（regex 降级兜底）
- AutoDream 定期提取

### Phase 4 — MCP + Subtask

- MCP stdio 客户端（JSON-RPC 2.0）
- MCP 服务器生命周期管理（connect/disconnect/status）
- MCP 工具桥接（mcp__{server}__{tool} 命名空间）
- MCP 工具自动注入到 AgentLoop
- Subtask 隔离执行（深度=1，共享 MemoryStore）

### Phase 5 — Channels + Approval + Metrics

- Console 通道（readline + approval 交互）
- Telegram 通道（axios + long-poll + inline keyboard）
- Slack 通道（axios + Web API polling）
- 通道注册表（register/get/startAll/stopAll）
- ApprovalGate（Promise 暂停 + 超时自动拒绝）
- JSONL 指标收集器（按日期分文件 + 自动 flush + 过期清理）
- Agent 遥测封装（turn/tool/memory/compaction 事件）

### Phase A — Skills

- Skills 统一策略（加载 + @scope + 多路径解析 + listing/search + frontmatter 解析 + mtime 缓存）

### Phase B — Guard M2

- 滑动窗口速率限制器（per tool per session）
- 内容过滤（PII 检测 + Prompt Injection 扫描 + 自定义模式）
- 工具权限矩阵（glob 匹配 allow/deny/ask）
- 审计日志统一覆盖（permission / rate_limit / content_filter）
- Hook 集成（权限 → 速率限制 → classifier 优先级链）
- AgentLoop 集成（工具输出内容过滤）

### Phase C — E2E Tests

- 可复用 Fake LLM Server（多轮 tool_calls + 请求日志）
- E2E 工具调用链（CLI spawn + fake server + read 工具）
- E2E Guard M2 权限拒绝（PermissionMatrix deny → Pipeline 拦截）
- E2E Guard M2 内容过滤（PII 输出 → 内容过滤器替换）

### Phase D — MCP HTTP Transport

- MCP Transport 抽象（MCPTransport 接口 + stdio/http 选择）
- MCP Streamable HTTP transport（POST + JSON/SSE 响应 + Mcp-Session-Id）
- StdioTransport 从 client.ts 提取
- MCP HTTP transport 单元测试（6 个用例）
- MCP HTTP transport E2E 测试（连接 + 工具发现 + callTool）

### Phase E — Documentation

- LICENSE 文件（MIT）
- skills/qingling.md 工具列表补全
- README 补充（前置条件、Guard M2、MCP HTTP、通道、审批流、指标、源码树）
- CHANGELOG.md
