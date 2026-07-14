---
name: pr-summary
description: 根据 git diff / 最近提交写中英 PR 摘要与测试计划
tags: [example, git, docs, shipping]
triggers: [PR 摘要, pull request, changelog, 发布说明]
---

# PR Summary

## 何时使用

用户要「写 PR 描述」「总结这次改动」「release notes」时加载。

## 步骤

1. `bash`：`git status` / `git log --oneline -15` / `git diff`（或 `git diff main...HEAD`）
2. 按 **Why / What / How to test** 组织
3. 标出 breaking change / 迁移注意（若有）
4. 中文主描述 + 可选英文一节

## 输出模板

```markdown
## Summary
- …

## Test plan
- [ ] …
```

## 约束

- 不编造未出现的文件或测试结果
- 密钥/token 不得写入摘要
