# Skills 约定

轻灵通过 Markdown skill 扩展领域知识。扫描路径（去重，优先靠前）：

1. **包内** `skills/`（随 `@qlingzzy/qling` 安装，全局可用）
2. 本机 `~/.qling/skills/`
3. 当前工作区 `skills/`
4. 项目 `.qling/skills/`（若存在）
5. 可选 `HERMES_HOME/skills`

内置：`opencli`（平台数据必读）、`qling`、`examples/repo-triage`、以及 **lifecycle-*** 生命周期六件套。

## 渐进加载（Progressive Skills）

| 层级 | 内容 |
|------|------|
| System 索引 | 仅 `name` / `description` / `tags` / `triggers`（短描述） |
| 按需正文 | `skill name="..."` 或 `/skill <name>` 加载 Markdown body |

**原则**：用到什么知识，临时加载什么知识，不把全部 skill 正文塞进 system prompt。

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
triggers: [关键词1, 场景2]
---
```

## 安全扫描

加载 skill 前默认静态扫描（`QLING_SKILL_SCAN`）：

| 值 | 行为 |
|----|------|
| `on`（默认） | critical/high 命中则 **拒绝加载** |
| `warn` | 仅警告仍加载 |
| `off` | 关闭（仅调试） |

规则覆盖：私钥 PEM、典型密钥形态、`curl|bash` / `irm|iex`、可疑 base64 执行等。

## 生命周期 skills

| name | 用途 |
|------|------|
| `lifecycle-spec` | 规格 / 验收 |
| `lifecycle-plan` | 任务拆分 |
| `lifecycle-build` | 增量实现 |
| `lifecycle-test` | 测试证明 |
| `lifecycle-review` | 合并前审查 |
| `lifecycle-ship` | 发布清单 |

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
/skill lifecycle-plan
```

## 设计原则

1. **短而可执行** — 步骤可直接变成工具调用
2. **诚实边界** — 写清不要做什么
3. **本地优先** — 不要求外网上传
4. **渐进加载** — 索引进 prompt，正文 on-demand
5. **默认可扫描** — 第三方 skill 先过安全规则
