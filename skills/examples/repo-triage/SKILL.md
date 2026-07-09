---
name: repo-triage
description: 快速摸清陌生仓库：结构、入口、脚本、风险与下一步
tags: [example, onboarding, repo]
---

# Repo Triage

## 何时使用

用户说「看看这个仓库」「快速上手这个项目」「分析项目结构」时加载。

## 步骤

1. **定位入口**
   - 读 `README.md`、`package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod`（存在哪个读哪个）
   - 记录 scripts / 依赖管理器

2. **结构鸟瞰**
   - 列出顶层目录（`bash`：`dir` / `ls`）
   - 识别 `src/`、`tests/`、`docs/`、配置目录

3. **可运行性**
   - 找到最小启动命令（build / test / start）
   - 不要自动 `npm install` 除非用户要求

4. **风险与边界**
   - 是否有 `.env.example`（不要读真实 `.env` 内容到对话里展示密钥）
   - 是否有 CI（`.github/workflows`）

5. **输出格式**（中文）

```markdown
## 仓库一览
- 技术栈:
- 入口:
- 关键脚本:

## 建议下一步
1. …
2. …

## 风险
- …
```

## 约束

- 默认只读；需要改文件先说明原因
- Plan Mode 下只输出计划，不写盘
