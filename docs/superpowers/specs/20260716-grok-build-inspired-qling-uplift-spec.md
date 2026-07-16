# 轻灵 × Grok Build 对标分析与提升计划

**对标仓库**: https://github.com/xai-org/grok-build  
**分析日期**: 2026-07-16  
**轻灵基线**: `@qlingzzy/qling@1.2.2`（Node/TS · 本地优先中文工作台）  
**原则**: 学架构与产品能力，不重写为 Rust 克隆；保留差异化。

---

## 1. Grok Build 是什么

| 项 | 内容 |
|----|------|
| 定位 | SpaceXAI 终端 AI coding agent harness + full-screen TUI |
| 语言 | Rust ~99.6%（ratatui 系 TUI） |
| 规模 | ~7.9k★ · 单 monorepo 同步快照 · Apache-2.0 |
| 二进制 | 安装名 `grok`；源码包 `xai-grok-pager` |
| 运行形态 | **交互全屏 TUI** · **Headless/CI** · **ACP 嵌入编辑器** |
| 工具渊源 | 含 openai/codex 与 sst/opencode 工具实现的 in-tree 移植（见 THIRD-PARTY-NOTICES） |

### 1.1 仓库分层（可借鉴的「拼装根」）

```
xai-grok-pager-bin     组合根 / 二进制
xai-grok-pager         TUI：scrollback · prompt · modal · render
xai-grok-shell         Agent 运行时 · headless · stdio
xai-grok-tools         终端/读写/搜索等工具
xai-grok-workspace     文件系统 · VCS · 执行 · checkpoint
xai-grok-mcp / hooks / memory / sandbox / config / …
xai-acp-lib            Agent Client Protocol
```

**关键洞见**: **Pager（展示）与 Shell（运行时）硬分离**；工具与 workspace 再下沉。轻灵当前 `agent-loop` 巨石 + `streaming-tui` 紧耦合，这是架构债主因。

### 1.2 产品能力地图（用户指南 24 篇）

| 层级 | 能力 | 文档 |
|------|------|------|
| 入门 | 安装、浏览器鉴权、API Key、更新通道 | 01–02 |
| 交互 | 全屏 scrollback、Simple/Vim 模式、鼠标、折叠/展开 | 03 |
| 命令 | `/new` `/resume` `/fork` `/rewind` `/compact` `/context` … | 04 |
| 外观 | 多主题、`/theme`、`pager.toml`、truecolor 降级 | 06 |
| 扩展 | MCP · Skills · Plugins marketplace · Hooks · AGENTS.md | 07–12 |
| 记忆 | 可选跨会话 MEMORY.md + hybrid search（默认关） | 13 |
| 自动化 | `grok -p` headless、输出格式、CI | 14 |
| Agent | 模式、子 agent、会话、沙箱、Plan mode | 15–19 |
| 长任务 | background 命令、`/loop`、monitor、scheduler、Ctrl+G | 20 |
| 安全 | 多层权限 + OS sandbox profiles | 22 |
| **Dashboard** | **TUI 内多会话舰队看板**（peek/attach/dispatch） | 23 |
| 可观测 | 外部 OpenTelemetry（双 opt-in、默认无内容） | 24 |

---

## 2. Grok Build 的 Dashboard 与轻灵不同

| 维度 | Grok Build Dashboard | 轻灵 Dashboard（现状） |
|------|----------------------|------------------------|
| 形态 | **TUI 内屏**（`grok dashboard` / `/dashboard` / `Ctrl+\`） | **本机 Web**（`127.0.0.1`） |
| 对象 | 顶层 session / fork 舰队 | mission / loop / workflow 长任务 |
| 操作 | peek · Enter attach · stop · pin · dispatch | pause / resume / cancel / retry |
| 隐喻 | 「多 Agent 会话总台」 | 「长任务与守护进程工作台」 |

**结论**: 两者不互相替代。轻灵应 **保留 Web 任务工作台**，并 **补一层 TUI 内会话切换器**（Grok 的核心体验）。

---

## 3. 轻灵 vs Grok Build 差距矩阵

| 领域 | Grok Build | 轻灵现状 | 差距 | 优先级 |
|------|------------|----------|------|--------|
| TUI 渲染 | 全屏 managed · 独立 scrollback 选择/折叠 | append-only 流 + 极简框 | 大（手感） | P0 |
| 启动体验 | 干净首屏 | 已做 boot quiet + 圆角 | 小 | 已收敛 |
| 会话 | resume picker · fork · rewind · rename | sessions 列表 + continue | 中 | P0 |
| Plan mode | 只读规划工具 + 审批出口 | 有 plan 权限/文案碎片 | 中 | P1 |
| 后台任务 | bg shell · wait/kill · Ctrl+G · monitor | mission/daemon/loop | 中（缺统一 task_id） | P1 |
| 沙箱 | OS profile（workspace/devbox/strict…） | Guard + 可选 sandbox 片段 | 大 | P1–P2 |
| 权限 | hooks→rules→grant→mode 流水线 | allow/ask/deny + approval | 中 | P1 |
| 主题 | 5 主题 + auto + `/theme` | 单套竹青绿 tokens | 中 | P1 |
| Skills | 多根目录 + marketplace + Claude/Cursor 兼容 | skills 有，marketplace 弱 | 中 | P1 |
| Headless | `grok -p` 脚本/CI 一等公民 | `run` 有，缺稳定 JSON/协议 | 中 | P1 |
| 编辑器 | ACP | 无 | 大（可选） | P2 |
| Dashboard | TUI 会话舰队 | Web 长任务板 | **差异化保留** | 增强 |
| 中文/本地叙事 | 弱 | **强** | 优势 | 保持 |
| 记忆 | 可选、偏文档型 | WAL + 语义/认知（默认更激进） | 互有长短 | 调优 |
| 语言栈 | Rust | Node/TS | 不迁移 | — |

---

## 4. 针对性提升计划（轻灵）

### 战略定位（一句话）

> **Grok Build 级「会话舰队 + 计划/后台/权限」能力** × **轻灵「中文本地任务工作台 + Web Mission Control」**  
> 不做 Rust 重写；做 **产品层与模块边界** 升级。

### Phase G0 — 体验基线（已在做 / 1 周内收口）

| ID | 项 | 说明 |
|----|----|------|
| G0.1 | 静默启动 | 仅顶栏+输入框；Dashboard 后台默认起（已完成） |
| G0.2 | TUI tokens + 圆角 | 输入框走真实渲染路径（已完成） |
| G0.3 | Web Dashboard 入口 | `qling dashboard` + sessions 条（已完成） |
| G0.4 | 启动日志回归测试 | boot quiet 单测 + 人工清单 |

### Phase G1 — TUI 交互质变（2–3 周）**最高 ROI**

对标 Grok：scrollback 可导航、会话可切换。

| ID | 交付 | 对标 | 验收 |
|----|------|------|------|
| G1.1 | **会话切换器**（TUI 内） | `/dashboard` Ctrl+\ 舰队 | `/sessions` 弹层：↑↓ 选、Enter resume；不离开终端 |
| G1.2 | **Scrollback 导航 MVP** | j/k · 跳转 turn | PageUp/Down 或 Shift+↑↓ 按「用户轮」跳；不强制全屏 alternate |
| G1.3 | **折叠工具输出统一** | fold/expand | 已有 Ctrl+O；补齐「选中块 e/E」或 slash `/expand last` |
| G1.4 | **Prompt 焦点模型** | Space → focus prompt | 滚动浏览时 Enter 回到输入；文档化快捷键 |
| G1.5 | 架构拆分 | pager vs shell | `StreamUI` 只负责显示；事件总线与 Agent 解耦（接口层，非重写） |

**刻意不做（G1）**: 迁 ratatui/Rust；全量 Vim 模式（可放 G3）。

### Phase G2 — 会话生命周期（2 周）

对标 `/fork` `/rewind` `/resume` picker · `/compact`。

| ID | 交付 | 验收 |
|----|------|------|
| G2.1 | `/resume` **交互选择器** | 列表最近 N 个 session，非只命令行 ID |
| G2.2 | `/fork` | 复制当前消息/检查点到新 sessionId |
| G2.3 | `/rewind [n]` | 丢弃最近 n 轮 user/assistant（落盘） |
| G2.4 | `/compact` 可指定保留主题 | 与现有 context-compactor 接线 |
| G2.5 | `/context` 分类占用 | system / messages / tools / free 类 Grok 的 breakdown |

### Phase G3 — Plan · 后台 · 权限（2–3 周）

| ID | 交付 | 对标 |
|----|------|------|
| G3.1 | **Plan Mode 产品化** | enter/exit 工具或 `/plan`；只读工具集；写 plan 文件；用户批准后实施 **（已完成）** |
| G3.2 | **Background tool 统一** | `task_id` · list · wait · kill；TUI 通知一行；接 mission 不必重做 **（已完成）** |
| G3.3 | **权限流水线文档化实现** | PreToolUse hook → deny/ask/allow → remembered grant → mode **（已完成）** |
| G3.4 | **Sandbox profiles** | `workspace` / `read-only` / `strict` 配置面；Windows 先做 path allowlist 软沙箱 **（已完成）** |
| G3.5 | 主题包 | `bamboo`（默认）· `night` · `mono`；`/theme` + env **（已完成）** |

### Phase G4 — 双表面 Dashboard（1–2 周）

| ID | 交付 | 说明 |
|----|------|------|
| G4.1 | Web 保持 Mission Control | mission/loop/workflow + sessions 条 |
| G4.2 | **TUI Session Dashboard** | 与 Web 分工：TUI=对话舰队；Web=长任务/daemon |
| G4.3 | 双向深链 | Web 显示 `qling --resume id`；TUI `/dashboard` 打开 Web URL 可选 |
| G4.4 | 空态与引导 | 无 mission 时引导 `/mission`；无 session 时引导对话 |

### Phase G5 — 自动化与生态（按需）

| ID | 交付 | 对标 |
|----|------|------|
| G5.1 | `qling run --json` / headless 事件流 | `grok -p` |
| G5.2 | Skills 扫描 `.claude` / `.cursor` / `.agents` 兼容路径 | 08-skills · **部分完成 2026-07-16**（路径+斜杠空格+参数） |
| G5.3 | Hooks JSON 生命周期（Pre/PostToolUse, SessionStart） | 10-hooks |
| G5.4 | 插件/技能安装源（自建 registry，不做 xAI marketplace 克隆） | 09-plugins |
| G5.5 | （可选）ACP 适配器 | 编辑器嵌入 · 工作量大 |
| G5.6 | （可选）OTEL 外部导出 | 24-monitoring · 默认关 |

---

## 5. 架构目标态（轻灵）

```
                    ┌─────────────────────┐
                    │  CLI / headless     │
                    │  ACP (later)        │
                    └─────────┬───────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌────────────┐  ┌─────────────┐
        │ StreamUI │   │ Session    │  │ Web Mission │
        │ (pager)  │   │ Dashboard  │  │ Control     │
        └────┬─────┘   │ (TUI)      │  │ Dashboard   │
             │         └─────┬──────┘  └──────┬──────┘
             └───────────────┼────────────────┘
                             ▼
                    ┌─────────────────┐
                    │  Agent Runtime  │  ← 从 agent-loop 拆
                    │  tools · memory │
                    │  guard · plan   │
                    │  bg tasks       │
                    └─────────────────┘
```

---

## 6. 明确不做 / 慎做

| 项 | 原因 |
|----|------|
| 用 Rust 重写轻灵 | 成本与中文社区栈不匹配 |
| 全盘复制 Grok 鉴权/x.ai 账号体系 | 轻灵本地 key 模型更合适 |
| 用 Web Dashboard 冒充 Grok 会话舰队 | 隐喻不同；应双轨 |
| 默认打开 OS 硬沙箱到无法开发 | 先配置面 + 软路径策略 |
| 外部 OTEL 默认开 | 与「本地优先 / 默认不外传」冲突 |

---

## 7. 成功指标

| 指标 | 目标 |
|------|------|
| 冷启动视觉 | 仅顶栏+输入（已达成） |
| 会话切换 | ≤3 键从当前对话 resume 另一 session |
| Plan 任务 | 模糊需求默认可进入 plan 并产出可审批文档 |
| 后台任务 | 一次 `npm test` 可 bg，对话不卡，可 kill |
| Dashboard | Web 管理长任务；TUI 管理对话 session |
| 回归 | 现有 unit/smoke 不降；新增 quiet/session/plan 测 |

---

## 8. 建议执行顺序（下 6–8 周）

1. **G1.1 + G2.1** 会话选择器（体感最接近 Grok Dashboard）  
2. **G1.2** scrollback 轮次导航  
3. **G3.1** Plan mode  
4. **G3.2** 后台 task_id  
5. **G4** 双表面文案与深链  
6. **G3.3–G3.5** 权限/沙箱/主题  
7. **G5** headless/skills/hooks 按用户量推进  

---

## 9. 参考链接

- 仓库: https://github.com/xai-org/grok-build  
- 用户指南树: `crates/codegen/xai-grok-pager/docs/user-guide/`  
- 在线文档: https://docs.x.ai/build/overview  
- 第三方移植声明: `THIRD-PARTY-NOTICES`、`xai-grok-tools/THIRD_PARTY_NOTICES.md`
