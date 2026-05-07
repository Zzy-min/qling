# Changelog

## v0.5.0 (2026-05-07)

### Phase F — Missions & Browser

- **Browser Fetch (v0.5)**: 集成 Playwright 支持 JS 渲染页面抓取
- **Mission Manager**: 引入长任务状态管理与持久化队列
- **Onboarding flow**: 交互式 `qingling setup` 配置向导
- **Daemon Mode**: 后台守护进程支持（`npm run daemon`）
- **性能优化**: 优化了流式 TUI 的渲染抖动问题

## v0.4.0 (2026-05-05)

### Phase D-E — Connectivity & Quality

- **MCP HTTP Transport**: 支持基于 HTTP 的 Streamable MCP 服务器
- **E2E Testing Framework**: 引入 Fake LLM Server 与完整的工具链测试
- **Guard M2 增强**: 完善了内容过滤与权限矩阵的审计日志
- **文档补全**: 完成了完整的项目架构说明与工具手册

## v0.3.0 (2026-05-03)

### Phase 5, A, B — Production Ready

- **Channels**: 增加 Telegram 与 Slack 通道支持
- **Dashboard**: 内置 Web 观测台，可视化思考链路
- **Semantic Memory**: 基于 SQLite 的向量记忆索引
- **Dynamic Skills**: 支持从目录或 URL 动态加载技能
- **Approval Gate**: 引入工具调用审批流与超时拒绝机制

## v0.2.0 (2026-05-02)

### Phase 3-4 — Memory & MCP

- **Memory System**: 三层记忆架构（Scratchpad → Conversation → Persisted）
- **WAL Log**: 记忆追加日志与崩溃恢复机制
- **MCP Stdio Client**: 实现 JSON-RPC 2.0 协议的 MCP 客户端
- **Subtask**: 支持隔离的子任务执行逻辑

## v0.1.0 (2026-05-01)

### Phase 0-2 — Foundation & Stability

- 统一配置平面（CLI > ENV > config > defaults）
- 运行模式（run/chat/repl 子命令）
- Guard M1（URL 白名单、私网拦截、审计日志）
- 错误语义升级与统一
- 核心回归用例（Search/Compactor/Loop）
