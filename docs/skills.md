# Skills 约定

轻灵通过 Markdown skill 扩展领域知识。扫描路径（去重，优先靠前）：

1. **包内** `skills/`（随 `@qlingzzy/qling` 安装，全局可用）
2. 本机 `~/.qling/skills/`
3. 当前工作区 `skills/`
4. 项目 `.qling/skills/`（若存在）
5. 可选 `HERMES_HOME/skills`

内置：`opencli`（平台数据必读）、`qling`、`examples/repo-triage`。

## 文件约定

| 形式 | 说明 |
|------|------|
| `skills/foo.md` | 单文件 skill |
| `skills/foo/SKILL.md` | 目录 skill（推荐） |
| `skills/foo/index.md` | 目录 skill 兼容 |

## Frontmatter

```yaml
---
name: my-skill
description: 何时使用该 skill（给模型做路由）
tags: [optional, tags]
---
```

## 模板与示例

- 模板：`skills/templates/SKILL.md`
- 示例：`skills/examples/repo-triage/SKILL.md`

复制模板：

```bash
mkdir -p skills/my-skill
cp skills/templates/SKILL.md skills/my-skill/SKILL.md
# 编辑 name / description / 正文
```

在 TUI 中：

```text
/skill list
/skill my-skill
```

## 设计原则

1. **短而可执行** — 步骤可直接变成工具调用  
2. **诚实边界** — 写清不要做什么  
3. **本地优先** — 不要求外网上传  
