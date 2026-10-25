---
name: opencli
description: >
  可选的本机 opencli 手册。仅当用户明确要求使用 opencli 时加载。
  网页搜索、打开链接和浏览器控制默认走 url_fetch、browser_fetch、browser_act，
  不要因为抖音、小红书、微博、B站、TikTok 或普通网页自动改用 opencli。
tags: [opencli]
---

# opencli 调用手册（轻灵 Agent）

本机 CLI：`opencli`（Universal CLI Hub）。通过 **bash 工具**执行，输出优先 **`-f json`**。

## 0. 启用条件

用户没有明确说出 opencli 时，不要加载或调用本技能。网页搜索用 `deepseek_search`，单页正文用 `deepseek_fetch`；没有 DeepSeek 密钥时再用 `url_fetch` / `browser_fetch`。点击、填表和登录态操作用 `browser_act`（`QLING_BROWSER_ACT=1`）。下面的命令只在用户点名 opencli 之后使用。

## 0b. 硬规则（用户已要求 opencli 时）

1. **用户已明确要求 opencli 后**，强反爬平台用对应站点命令，不要再改回 `url_fetch` / 裸 `curl` 硬抓。
2. **抖音 ≠ TikTok**
   - `douyin.com` / 国内抖音 → `opencli douyin …`
   - `tiktok.com` 国际版 → `opencli tiktok …`
3. 不确定有没有命令时：**先发现再调用**（见 §1），禁止臆造子命令。
4. 返回 HTML 含 `_$jsvmprt` / `acrawler` / `window.location.reload` → 这是**反爬挑战页**，不是业务数据；应改用对应 `opencli <site>` 适配器，并检查登录。
5. 未点名 opencli 时，文档页和普通网页走 `browser_fetch` / `url_fetch`，浏览器控制走 `browser_act`。

## 1. 发现命令（必做习惯）

```bash
opencli list -f json
opencli <site> --help
opencli <site> <command> --help
opencli doctor
```

- `list`：发现站点与命令。
- `--help`：参数与读写标签。
- `doctor`：Daemon / Chrome 扩展是否连通。

Agent tip：`opencli <site> --help -f yaml` 可拿结构化参数说明。

## 2. 标准调用形态

```bash
opencli <site> <command> [args] [options] -f json
```

常用选项：

| 选项 | 说明 |
|------|------|
| `-f json` | **默认用这个**，便于解析 |
| `-v` | 调试 |
| `--window foreground\|background` | 浏览器窗口 |
| `--site-session ephemeral\|persistent` | 会话生命周期 |

需要**用户已登录的 Chrome**（扩展已连接）时，先 `opencli doctor`；登录：

```bash
opencli <site> login
opencli <site> whoami -f json
```

## 3. 站点路由速查

| 用户意图 / URL | 正确入口 | 错误入口 |
|----------------|----------|----------|
| 抖音 / douyin.com | `opencli douyin` | `opencli tiktok`、`url_fetch` |
| TikTok 国际 | `opencli tiktok` | `opencli douyin` |
| 小红书 / xhslink / rednote | **优先** `opencli xiaohongshu`（也有 `opencli rednote` 英文别名） | `url_fetch`、只传裸 note-id |
| 微博 | `opencli weibo` | 裸抓 HTML |
| B 站 | `opencli bilibili`（以 list 为准） | 裸抓 HTML |
| 推特 / X | `opencli twitter` | 裸抓 HTML |
| 通用打开页面 | `opencli browser <session> open <url>` | 臆造 `browser open` 缺 session |

> 站点名以 `opencli list` 为准；上表为常见路由，未列出时以 list 为准。

## 4. 抖音（douyin）推荐流程

```bash
# 登录态
opencli douyin whoami -f json
# 未登录
opencli douyin login

# 搜索
opencli douyin search "关键词" -f json

# 作品列表 / 统计（有 aweme_id 时）
opencli douyin videos -f json
opencli douyin stats <aweme_id> -f json

# 用户视频（有 sec_uid 时）
opencli douyin user-videos <sec_uid> -f json

# 账号信息
opencli douyin profile -f json
```

常见子命令：`activities` `collections` `delete` `draft` `drafts` `hashtag` `location` `login` `profile` `publish` `search` `stats` `update` `user-videos` `videos` `whoami`。

写操作（delete/publish/update/draft）**先征得用户确认**。

## 4b. 小红书（xiaohongshu）— 高频失败点

### 本机前置

```bash
opencli doctor
opencli xiaohongshu whoami -f json   # logged_in 应为 true
# 未登录：
opencli xiaohongshu login
```

### 正确命令（优先 xiaohongshu，不要用 url_fetch）

```bash
# 搜索笔记（返回 title/author/likes/url；url 通常已带 xsec_token）
opencli xiaohongshu search "关键词" --limit 10 -f json

# 首页 Feed
opencli xiaohongshu feed --limit 10 -f json

# 笔记正文 + 点赞收藏评论（必须传「完整签名 URL」）
opencli xiaohongshu note "<完整笔记URL含xsec_token>" -f json

# 评论（同样要求完整签名 URL）
opencli xiaohongshu comments "<完整笔记URL含xsec_token>" --limit 20 -f json

# 用户主页笔记
opencli xiaohongshu user "<userId或主页URL>" --limit 15 -f json

# 下载媒体（完整 URL 或 xhslink 短链）
opencli xiaohongshu download "<完整笔记URL或xhslink>" --output ./xiaohongshu-downloads -f json
```

创作者中心（需创作者登录态）：`creator-profile` `creator-stats` `creator-notes` `creator-note-detail` `creator-notes-summary`。

### ⚠️ 关键：note / comments 不能只传 note-id

官方参数说明：`note-id` 实为 **Full Xiaohongshu note URL with xsec_token**。

| 传参 | 结果 |
|------|------|
| 仅 `6a3b66c5…` 裸 id | ❌ 失败：`requires a full signed URL` / exitCode 2 |
| `https://www.xiaohongshu.com/explore/<id>?xsec_token=...` | ✅ |
| 从 `search` / `feed` / `user` 结果里复制的 `url` 字段 | ✅（优先用这个） |

**正确流程：**

1. `search` 或 `feed` 拿列表
2. 从结果 JSON 取 `url`（含 `xsec_token`）
3. 再 `note` / `comments` / `download` 用该完整 url

禁止：跳过 search、手编 explore 链接且不带 token；禁止 `url_fetch` 打开小红书页。

### 别名

- `opencli rednote …` 与小红书同源英文适配器（feed/search/note/comments 等），**优先统一用 `xiaohongshu`**，避免混用导致参数习惯不一致。

## 5. 通用 browser 会话（高级）

形态：`opencli browser <session> <command> …`

```bash
# 先绑定真实 Chrome 标签（扩展在线）
opencli browser mysess bind
opencli browser mysess open "https://example.com"
opencli browser mysess state -f json
opencli browser mysess eval "document.title"
```

注意：

- **必须有 session 名**，不是 `opencli browser open url`。
- `eval` 参数是要执行的 JS；引号要按当前 shell 正确转义（Windows 用 `bash` 工具时走 cmd，注意转义）。
- 强反爬站点仍应优先站点适配器，而不是 browser+eval 硬抠。

## 6. 反模式（禁止）

| 反模式 | 原因 |
|--------|------|
| `url_fetch` 打开 douyin/xhs 分享链 | 返回挑战页 JS，无结构化数据 |
| `opencli tiktok` 处理 douyin.com | 错误站点 |
| 小红书 `note`/`comments` 只传裸 note-id | opencli 要求带 `xsec_token` 的完整 URL |
| 未 `list`/`--help` 就编造命令 | 易失败 |
| 把挑战页 HTML 当成功数据总结 | 误导用户 |
| 未确认就 `delete`/`publish` | 写操作风险 |

## 7. 失败诊断清单

1. `opencli doctor` — Daemon / Extension 是否 OK
2. `opencli <site> whoami -f json` — 是否登录
3. `opencli <site> --help` — 命令是否存在、参数是否正确
4. 若仍是反爬页 — 换站点适配器 API 命令，而不是加大 `url_fetch` 重试

## 8. 与轻灵其他工具的分工

| 工具 | 默认 | 用途 |
|------|------|------|
| **url_fetch** | 开 | 搜索结果、HTTP API、静态页 |
| **browser_fetch** | 开 | 需 JS 渲染的只读页面摘要 |
| **browser_act** | **关** | 点击/填表（`QLING_BROWSER_ACT=1`），默认浏览器控制 |
| **opencli**（via bash） | 不默认 | 仅用户明确要求时的站点适配器 |
| **skill opencli** | — | 本手册。用户没点名就不要加载 |

完整路由：包内 `docs/web-routing.md`。

## 9. 最短决策树

```
需要网页或浏览器操作？
├─ 用户没有明确说 opencli
│   → 搜索 / 只读：url_fetch 或 browser_fetch
│   → 点击 / 填表：browser_act（QLING_BROWSER_ACT=1，同进程 session 跨步保活）
└─ 用户明确要求 opencli
    → 加载本 skill
    → opencli list / <site> --help
    → whoami/login → 业务命令 -f json
```
