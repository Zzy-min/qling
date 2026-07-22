# 网页 / 平台数据路由

轻灵有多条「上网」路径。**先选对通道，再调用**，避免反爬挑战页被当成成功数据。

## 决策树

```
需要外部数据？
├─ 社交/内容平台（抖音、小红书、微博、B站、TikTok、X…）
│   → skill name="opencli"
│   → bash: opencli <site> … -f json
│   → 禁止 url_fetch / browser_* 当主路径
│
├─ 普通 HTTPS API / 静态页
│   → url_fetch（Guard 白名单 / 私网拦截）
│
├─ 文档站 / 弱反爬、需 JS 渲染摘要
│   → browser_fetch（Playwright 只读抓取）
│
├─ 需要点击/填表等交互（实验）
│   → 优先 opencli browser <session> …
│   → 或启用 browser_act（QLING_BROWSER_ACT=1，默认关）
│
└─ 不确定
    → opencli list / doctor；不要盲目重试 url_fetch
```

## 工具对照

| 工具 | 默认 | 能力 | 典型场景 |
|------|------|------|----------|
| **opencli**（via bash） | 本机已装则可用 | 站点适配器、登录会话、结构化 JSON | 抖/红/微/B/推 |
| **url_fetch** | 开 | HTTP + Guard | 公开 API、静态资源 |
| **browser_fetch** | 开 | 无头浏览、正文摘要 | 文档站 SPA |
| **browser_act** | **关** | goto/click/type/extract | 显式启用后的弱交互 |

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
- 强反爬平台仍应 **opencli**，不要靠 browser_act 硬抠

## 失败诚实

| 现象 | 含义 | 动作 |
|------|------|------|
| HTML 含 `_$jsvmprt` / `acrawler` | 反爬挑战页 | 换 opencli 站点命令 + 登录 |
| `BROWSER_ACT_DISABLED` | 未开启交互 | 开 env 或改 opencli browser |
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

- Skill：`skills/opencli/SKILL.md`
- 沙箱/网络：`docs/docker.md`、环境变量 `QLING_GUARD_*`
