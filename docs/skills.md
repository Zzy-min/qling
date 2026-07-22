# Qling Skills 约定

轻灵通过 Markdown skill 扩展领域知识。目录按“先出现优先”去重，同名 skill 不会被后续来源覆盖。

## 实际优先级

### 1. 当前工作区

默认扫描：

```text
<workspace>/skills/
<workspace>/.qling/skills/
<workspace>/.grok/skills/
<workspace>/.grok/commands/
<workspace>/.agents/skills/
<workspace>/.claude/skills/
<workspace>/.claude/commands/
<workspace>/.cursor/skills/
```

### 2. 用户目录

默认扫描用户主目录下对应的 `.qling`、`.grok`、`.agents`、`.claude` 和 `.cursor` 路径。

### 3. 随包内置

最后加载包内 `skills/`，因此项目或用户 skill 可以覆盖同名内置 skill。当前内置可执行项包括：

- `qling`
- `opencli`
- `lifecycle-spec`
- `lifecycle-plan`
- `lifecycle-build`
- `lifecycle-test`
- `lifecycle-review`
- `lifecycle-ship`

### 4. 可选 Hermes

Hermes 路径默认关闭。只有同时设置 `QLING_INCLUDE_HERMES_SKILLS=1` 和 `HERMES_HOME` 时，才追加扫描 `$HERMES_HOME/skills`。

兼容目录开关默认开启，可分别用以下环境变量设为 `0` / `false` 关闭：

- `QLING_GROK_SKILLS_ENABLED`
- `QLING_AGENTS_SKILLS_ENABLED`
- `QLING_CLAUDE_SKILLS_ENABLED`
- `QLING_CURSOR_SKILLS_ENABLED`

## 渐进加载

| 层级 | 内容 |
|---|---|
| System 索引 | 只放 `name`、`description`、`tags`、`triggers` 等短元数据 |
| 按需正文 | 通过 `skill` 工具、`/skill <name>` 或 `/<skill-name>` 读取 Markdown body |

原则：用到什么，加载什么；不把所有 skill 正文塞进系统 Prompt。

## 文件形式

| 形式 | 说明 |
|---|---|
| `skills/foo.md` | 单文件 skill |
| `skills/foo/SKILL.md` | 目录 skill，推荐 |
| `skills/foo/index.md` | 兼容目录入口 |

Frontmatter：

```yaml
---
name: my-skill
description: 何时使用这个 skill
tags: [optional, tags]
triggers: [关键词1, 场景2]
---
```

缺少或损坏的 frontmatter 会降级为文件名和空描述；没有有效描述、命中占位规则或位于归档目录的项目不会进入可执行 catalog。

## Catalog 与归档

以下目录名默认跳过或归档，不进入 `/skill` 可执行列表：

```text
templates, template, archive, _archive, archived,
examples, example, .git, node_modules, __pycache__
```

因此 `skills/examples/` 是测试和写作参考，不会自动注册。要试用示例，请复制到工作区或用户 skill 目录：

```bash
mkdir -p .qling/skills
cp -R skills/examples/fix-failing-test .qling/skills/
```

Windows PowerShell：

```powershell
New-Item -ItemType Directory -Force .qling\skills | Out-Null
Copy-Item -Recurse skills\examples\fix-failing-test .qling\skills\
```

参考示例：`repo-triage`、`fix-failing-test`、`add-function`、`pr-summary`。

## 安全扫描

加载 skill 前运行静态扫描：

| `QLING_SKILL_SCAN` | 行为 |
|---|---|
| `on`（默认） | critical/high 命中时拒绝加载 |
| `warn` | 记录警告但允许加载 |
| `off` | 关闭扫描，仅用于受控调试 |

规则覆盖私钥 PEM、常见密钥形态、`curl | bash` / `irm | iex` 和可疑 base64 执行等模式。扫描通过不等于代码可信；第三方 skill 仍需人工审查。

## 使用

```text
/skill
/skill list
/skill search test
/skill my-skill
/skill archived
```

- `/skill` 打开可过滤的本地切换器。
- `/skill archived` 只展示归档、占位和被同名前序来源覆盖的条目，不执行它们。
- `/<skill-name>` 可直接加载 skill；内置 slash 命令优先于同名 skill。

## 新建 skill

模板：`skills/templates/SKILL.md`。

```bash
mkdir -p .qling/skills/my-skill
cp skills/templates/SKILL.md .qling/skills/my-skill/SKILL.md
```

完成后运行 `/skill search my-skill`，确认它位于预期来源、描述非空且没有被同名项覆盖。

## 设计原则

1. **工作区优先**：项目决策可以覆盖用户和内置默认值。
2. **短而可执行**：步骤能直接转化为工具调用。
3. **诚实边界**：明确不要做什么以及何时停止。
4. **本地优先**：默认不要求把内容上传到外部服务。
5. **渐进加载**：短索引进 Prompt，正文按需加载。
6. **先扫描再信任**：静态扫描是最低门槛，不替代来源审查。
