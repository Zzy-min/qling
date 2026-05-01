# 能力现状矩阵（2026-04-30）

## 运行模式
- `run|chat|repl` 子命令：已实现
- 无参数默认进入 `chat(TUI)`：已实现
- 旧入口兼容（`--tui/--repl/--once/位置参数`）：已实现（含 deprecation 提示）

## 配置治理
- 优先级 `CLI > ENV > config > defaults`：已实现
- `QINGLING_*` 命名映射：已实现
- `${ENV_VAR}` 展开与缺失告警：已实现
- `--config` 指定配置文件：已实现

## 目录根与路径
- `workspace_dir` / `file_cache_dir` / `file_state_dir`：已实现
- 工具参数支持根别名路径：已实现（read/write/search/bash cwd）
- 路径越界拦截：已实现

## 工具与错误语义
- 三层工具注册（静态/运行时/通道）：已实现
- 结构化错误模型 `code/message/retriable/category`：已实现
- 终端兼容格式 `Error: [CODE] message`：已实现

## Guard M1
- URL 前缀白名单：已实现
- 私网目标拦截：已实现
- 脱敏：已实现
- 审计日志 JSONL：已实现（主路径：`url_fetch`）
- 审批流：已实现（Phase 5）

## Guard M2（Phase B）
- 滑动窗口速率限制器（per tool per session）：已实现（`src/guard/rate-limit.ts`）
- 内容过滤（PII 检测 + Prompt Injection 扫描 + 自定义模式）：已实现（`src/guard/content-filter.ts`）
- 工具权限矩阵（glob 匹配 allow/deny/ask）：已实现（`src/guard/permissions.ts`）
- 审计日志统一覆盖（permission / rate_limit / content_filter）：已实现
- GuardConfig 扩展（rate_limit / content_filter / permissions 节 + env 映射）：已实现
- Hook 集成（权限矩阵 → 速率限制 → classifier 优先级链）：已实现
- AgentLoop 集成（工具输出内容过滤）：已实现

## 观测与调试
- 每轮工具数/失败率/压缩次数/重试次数日志：已实现
- `--inspect-prompt` / `--inspect-request` 落盘：已实现
- 持久化指标聚合：已实现（Phase 5）

## 记忆系统
- 三层架构（Scratchpad → Conversation → Persisted）：已实现
- WAL 追加日志（JSONL + 序列号 + 校验和）：已实现（Phase 3）
- 投影 Worker（后台回放 + checkpoint）：已实现（Phase 3）
- 崩溃恢复（WAL 重放）：已实现（Phase 3）
- 记忆压缩（去重 + 过期 + 上限裁剪）：已实现（Phase 3）
- LLM 增强记忆提取（regex 降级兜底）：已实现（Phase 3）
- AutoDream 定期提取：已实现
- WAL + 投影配置：已实现（`QINGLING_MEMORY_WAL_ENABLED` 等）

## 扩展平面
- Skills 统一策略：已实现（加载 + @scope + 多路径解析 + listing/search + frontmatter 解析 + mtime 缓存）
- MCP stdio 客户端（JSON-RPC 2.0）：已实现（Phase 4）
- MCP 服务器生命周期管理（connect/disconnect/status）：已实现（Phase 4）
- MCP 工具桥接（`mcp__{server}__{tool}` 命名空间）：已实现（Phase 4）
- MCP 工具自动注入到 AgentLoop：已实现（Phase 4）
- Subtask 隔离执行（深度=1，共享 MemoryStore）：已实现（Phase 4）
- Subtask 工具定义：已实现（Phase 4）
- MCP Transport 抽象（`MCPTransport` 接口 + stdio/http 选择）：已实现（Phase D）
- MCP Streamable HTTP transport（POST + JSON/SSE 响应 + Mcp-Session-Id）：已实现（Phase D）
- MCP HTTP transport 单元测试（6 个用例：握手/SSE/Session-Id/工具调用/缺失 URL/自定义 Header）：已实现（Phase D）
- MCP HTTP transport E2E 测试（连接 + 工具发现 + callTool + 连接失败）：已实现（Phase D）

## 通道化
- CLI 主干：已实现
- 默认通道装配范围：仅 `run` 模式生效（`chat/repl` 不自动装配）：已实现
- Console 通道（readline + approval 交互）：已实现（run 模式可装配）
- Telegram 通道（axios + long-poll + inline keyboard）：已实现（run 模式可装配）
- Slack 通道（axios + Web API polling）：已实现（run 模式可装配）
- 通道注册表（register/get/startAll/stopAll）：已实现（Phase 5）

## 审批流
- ApprovalGate（Promise 暂停 + 超时自动拒绝）：已实现（Phase 5）
- ApprovalRequiredError（Pipeline 抛出 → AgentLoop 处理）：已实现（Phase 5）
- Hook ask 决策 → 审批流（替代原有的错误返回）：已实现（Phase 5）

## 持久化指标
- JSONL 指标收集器（按日期分文件）：已实现（Phase 5）
- Agent 遥测封装（turn/tool/memory/compaction 事件）：已实现（Phase 5）
- 指标查询（type/session_id/from/to/limit）：已实现（Phase 5）
- 自动 flush（100 条或定时 10s）：已实现（Phase 5）
- 过期指标清理（retention_days 消费）：已实现

## 稳定性保障（Phase 1 + Phase 2）
- search 回归用例（limit 截断 / context 差异 / glob 过滤 / Windows 路径）：已实现
- context-compactor 回归用例（tool_call 链保护 / recentKeep 边界 / 孤儿 tool 保留）：已实现
- agent-loop 最小回合 smoke（user → assistant(tool_calls) → tool → assistant）：已实现
- 统一错误语义（error-utils: toolError/toolSuccess + CODE 分类）：已实现
- 输入边界校验（search/read/write/bash 全覆盖）：已实现（含 timeout / 命令过长 / 大文件 / 路径不存在）
- 轻量可观测指标（per-turn 工具数/失败率/压缩次数/重试次数）：已实现
- 已知风险 + 防回归清单文档：已实现

## E2E 测试（Phase C）
- 可复用 Fake LLM Server（多轮 tool_calls + 请求日志）：已实现（`tests/helpers/fake-llm-server.mjs`）
- E2E 工具调用链（CLI spawn + fake server + read 工具）：已实现
- E2E Guard M2 权限拒绝（PermissionMatrix deny → Pipeline 拦截）：已实现
- E2E Guard M2 内容过滤（PII 输出 → 内容过滤器替换）：已实现

## 文档（Phase E）
- LICENSE 文件（MIT）：已实现
- skills/qingling.md 工具列表补全（9/9 工具 + CLI 模式 + Guard/MCP 概述）：已实现
- README 补充（前置条件、Guard M2、MCP HTTP、通道、审批流、指标、源码树）：已实现
- CHANGELOG.md（v0.1.0 版本记录，Phase 0-E 功能汇总）：已实现
