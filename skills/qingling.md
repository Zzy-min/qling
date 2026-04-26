---
name: qingling
description: 轻灵 Agent 自身使用指南
---

# 轻灵 Agent 使用指南

## 快速开始
```bash
cd C:/Users/Lenovo/projects/qingling
node dist/index.js "你的任务"
```

## 工具列表
- **bash**: 执行 Shell 命令
- **read**: 读取文件 (path, offset, limit)
- **write**: 写入文件 (path, content)
- **todo**: 任务管理 (action: list/add/done/cancel/remove/clear)
- **skill**: 动态加载知识文件

## 已知限制
- DeepSeek API 偶尔响应较慢，建议复杂任务设置较长超时
- write 工具不会追加，会覆盖整个文件
