# 轻灵正确调用 openCLI 规格

## 背景

Agent 在获取抖音等平台数据时，常误用 `url_fetch` / `browser_fetch` / `opencli tiktok`，撞上反爬挑战页或选错站点适配器。本机已安装 `opencli`（含 `douyin` 等站点命令），但 system prompt 未路由到正确调用方式。

## 目标

1. Agent **能发现** opencli 相关 skill（全局 npm 安装与仓库开发路径均可）。
2. Agent 在面对社交/强反爬平台时，**默认**先加载 `opencli` skill，再用 `bash` 执行 `opencli … -f json`。
3. 明确 **禁止** 用 `url_fetch` 抓抖音等强反爬页；明确 **TikTok ≠ 抖音**。

## 行为

### Skill

- 新增仓库内 `skills/opencli/SKILL.md`（name=`opencli`）。
- description 需覆盖触发词：opencli、抖音、小红书、微博、B站、TikTok、推特、反爬、登录抓取等。
- 正文包含：发现命令、站点路由、登录、`-f json`、反模式、边界。

### 始终在 system prompt 的短路由（Restrictions）

- 平台数据 → `skill name="opencli"` → `bash` 跑 opencli。
- 禁止 `url_fetch` 抖音类强反爬站。
- douyin.com → `opencli douyin`，禁止 `opencli tiktok`。

### Skill 扫描路径

`getSkillDirs()` 顺序（去重）：

1. 包内 `skills/`（随 `@qlingzzy/qling` 安装）
2. `~/.qling/skills/`
3. `cwd/skills/`
4. `cwd/.qling/skills/`
5. 可选 `HERMES_HOME/skills`

### 非目标

- 不把 opencli 重写成 MCP 服务器（可后续）。
- 不绕过抖音风控 / 不实现无登录强爬。
- 不自动升级本机 opencli 包版本。
