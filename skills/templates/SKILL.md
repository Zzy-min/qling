---
name: my-skill
description: 一句话说明该 skill 何时被加载、解决什么问题
tags: [example, template]
---

# My Skill

## 何时使用

- 场景 A
- 场景 B

## 步骤

1. 先用 `read` / `search` 收集事实
2. 用 `planner` 列出计划（必要时 `/plan on`）
3. 用 `patch` / `write` 做最小改动
4. 用 `bash` 跑验证命令（测试/lint）

## 约束

- 不要写入 `.env` 或密钥文件
- 不要在未确认时执行破坏性命令
- 输出中不要回显密钥

## 验收

- [ ] 行为符合描述
- [ ] 有可复现的验证命令

## 示例

```text
用户: ……
Agent: ……
```
