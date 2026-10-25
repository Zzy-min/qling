# 网页 / 浏览器路由

轻灵上网的默认通道是自带工具。**opencli 不是默认路径。**

## 决策树

```
需要外部页面或浏览器操作？
├─ 网页搜索
│   → deepseek_search（DeepSeek POST /v1/tools/search）
│
├─ 已知 URL，要 Markdown 正文
│   → deepseek_fetch（DeepSeek POST /v1/tools/fetch）
│
├─ 没有 DeepSeek 密钥，或 Search/Fetch 失败
│   → url_fetch（HTTP API / 静态页）
│   → browser_fetch（需要本机浏览器渲染的只读页）
│
├─ 点击、填表、跨步骤页面操作
│   → browser_act（QLING_BROWSER_ACT=1，默认关）
│
└─ 用户明确说「用 opencli」
    → skill name="opencli"
    → bash: opencli <site> … -f json
```

没有这句明确要求时，不要因为站点是抖音、小红书、微博、B站、TikTok 或 X，就改走 opencli。对话模型不会自动搜索，必须由工具调用 Search/Fetch。

## 工具对照

| 工具 | 默认 | 能力 | 典型场景 |
|------|------|------|----------|
| **deepseek_search** | 开 | DeepSeek 自研搜索 | 网页搜索 |
| **deepseek_fetch** | 开 | 单页转 Markdown | 搜索结果或已知 URL 的正文 |
| **url_fetch** | 开 | HTTP + Guard | 公开 API、静态资源、搜索失败后的兜底 |
| **browser_fetch** | 开 | 无头浏览、正文摘要 | 需要本机渲染的只读页 |
| **browser_act** | **关** | goto/click/type/extract | 显式启用后的页面操作 |
| **opencli**（via bash） | 不默认 | 站点适配器 | 仅用户点名时 |

## browser_act 启用与跨步会话

```powershell
# Windows PowerShell
$env:QLING_BROWSER_ACT = "1"
```

**推荐流程（同 session 保活页面）**：

```text
browser_act action=open session=demo url="https://example.com"
browser_act action=click session=demo selector="a.docs"
browser_act action=extract session=demo
browser_act action=close session=demo
browser_act action=status
```

- `session` 默认 `default`；进程内保活，跨多次 tool 调用
- 空闲超时默认 10 分钟：`QLING_BROWSER_ACT_IDLE_TTL_MS`
- 最大会话数默认 3：`QLING_BROWSER_ACT_MAX_SESSIONS`
- 与 `url_fetch` **共用网络 Guard**；**Plan Mode 禁止**

## 失败诚实

| 现象 | 含义 | 动作 |
|------|------|------|
| HTML 含 `_$jsvmprt` / `acrawler` | 反爬挑战页，这次抓取失败 | 说明失败；换 url_fetch / browser_fetch / browser_act，或询问是否改用 opencli |
| `BROWSER_ACT_DISABLED` | 未开启交互 | 设置 `QLING_BROWSER_ACT=1` 后再用 browser_act |
| Guard deny | 策略拦截 | 检查网络模式 / 白名单 |

## 使命通道通知

| 变量 | 默认 | 说明 |
|------|------|------|
| `QLING_MISSION_NOTIFY` | on | 总开关 |
| `QLING_MISSION_NOTIFY_STYLE` | rich | rich=TG HTML / Slack Blocks；plain=纯文本 |
| `QLING_MISSION_NOTIFY_LOGS` | milestone | off / milestone / all — 日志推送粒度 |
| `QLING_CHANNEL_TELEGRAM_TOKEN` + chat ids | — | Telegram |
| `QLING_CHANNEL_SLACK_BOT_TOKEN` + channel ids | — | Slack |

`qling doctor` 会摘要 browser_act / parallel / notify 开关。

## 相关

- 用户点名 opencli 时的命令手册：`skills/opencli/SKILL.md`
- 沙箱/网络：`docs/docker.md`、环境变量 `QLING_GUARD_*`
