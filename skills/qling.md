---
name: qling
description: 轻灵 Agent 自身使用指南
---

# 轻灵 Agent 使用指南

## 快速开始
```bash
cd C:/Users/Lenovo/projects/qling
node dist/index.js "你的任务"       # 一次性执行
node dist/index.js chat             # 流式 TUI（默认）
node dist/index.js repl             # 简易 REPL
```

## 工具列表
- **bash**: 执行 Shell 命令（支持 timeout、cwd 参数）
- **read**: 读取文件（path, offset, limit）
- **write**: 写入文件（path, content）— 注意：覆盖写入，非追加
- **search**: 搜索文件内容或文件名（pattern, file_glob, context, limit）
- **planner**: 生成任务执行计划（goal）
- **skill**: 动态加载知识文件（支持 @scope、多路径解析）
- **todo**: 任务管理（action: list/add/done/cancel/remove/clear）
- **url_fetch**: 受 Guard 约束的结构化网络请求（url, format）
- **subtask**: 隔离子任务执行（独立上下文，共享记忆，深度=1）

## CLI 模式
- `run <task>` — 一次性执行任务后退出
- `chat` — 流式 TUI 模式（默认，无参数时进入）
- `repl` — 简易 REPL 模式

## Guard 安全机制
- M1: URL 白名单、私网拦截、脱敏、审计日志
- M2: 速率限制、内容过滤（PII/注入检测）、工具权限矩阵

## MCP 扩展
- 支持 stdio 和 HTTP (Streamable) 两种 transport
- 工具命名空间: `mcp__{server}__{tool}`

## 已知限制
- DeepSeek API 偶尔响应较慢，建议复杂任务设置较长超时
- write 工具不会追加，会覆盖整个文件
