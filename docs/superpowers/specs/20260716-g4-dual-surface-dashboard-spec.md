# G4 双表面 Dashboard — 设计规格

**日期**: 2026-07-16  
**状态**: 已完成（2026-07-16）  
**对标源码**: Grok Build `xai-grok-pager`

---

## 0. 源码事实（Grok Build，必读）

| 路径 | 事实 |
|------|------|
| `docs/user-guide/23-dashboard.md` | 三入口：`grok dashboard` / `/dashboard`（别名 `/sessions`）/ `Ctrl+\` |
| `dispatch/dashboard.rs` | `ActiveView::AgentDashboard`；Ctrl+\ **toggle**；Enter = attach 全屏；默认焦点 `[+ New]` 而非静默 reply |
| `views/dashboard/row.rs` | 行每帧从 `app.agents` 重建；`RowState` 优先级 NeedsInput→Working→Idle→Inactive→Done→Failed |
| `views/dashboard/state.rs` | pin / reorder / grouping 持久化；按 `session_id` 而非 AgentId |
| `classify_top_level` | permission/question → NeedsInput；turn/bg/loop → Working；否则 Idle |
| `build_rows_with_roster` | 活仪表盘 **不列 subagent 行**；可并入 roster-only Inactive |
| 边界 | 与 auth/trust 互斥；feature flag `GROK_AGENT_DASHBOARD` |

**诚实边界（轻灵）**: append-only StreamUI **不能**做 Grok 真 viewport `ActiveView` 与 peek 面板。G4 在现有浮层体系内实现 **会话舰队语义**，Web 继续做 Mission Control（长任务/daemon），不混隐喻。

---

## 1. 双表面分工

```
┌──────────────────────────┐     ┌─────────────────────────────┐
│ TUI Session Dashboard    │     │ Web Mission Control         │
│ （会话舰队）               │     │ （任务工作台）                 │
│ · 已保存对话 session      │     │ · mission / loop / workflow  │
│ · 状态点 · 最近活跃       │     │ · daemon 健康 · 权限模式     │
│ · Enter → resume/switch  │     │ · 最近会话条 + 深链          │
│ · /dashboard · /sessions │     │ · qling dashboard start     │
│ · Ctrl+\                 │     │ · 仅 127.0.0.1              │
└──────────────────────────┘     └─────────────────────────────┘
```

| 表面 | 主责 | 非责 |
|------|------|------|
| TUI 舰队 | 扫会话、Attach/resume、空态引导对话 | 不冒充 mission 控制台 |
| Web MC | 长任务、暂停/恢复、预算、活动流 | 不假装多 agent 舰队 |

---

## 2. 功能需求

### G4.1 Web Mission Control（保持 + 补齐）

- 保留 snapshot：tasks / summary / runtime / activity
- sessions 条只读；展示深链命令（G4.3）
- 无 mission 空态引导 TUI `/mission` 或 CLI；无 session 引导「在 TUI 对话」

### G4.2 TUI Session Dashboard（舰队）

对标 Grok 行模型的 **轻量子集**：

| 字段 | 来源 |
|------|------|
| label | `title \|\| name` |
| state | `active` / `idle` / `stale`（见下） |
| secondary | 相对时间 · turns · tokens · workspace 短路径 |
| badges | 当前会话 `●` / 陈旧 |

**状态分类（磁盘会话 + 当前 runtime）**:

| 状态 | 条件 | 图标 | 排序优先级 |
|------|------|------|------------|
| active | `sessionId === current` | `●` | 3 |
| idle | 非当前且 24h 内更新 | `○` | 2 |
| stale | 超过 24h | `·` | 1 |

排序：优先级降序，同级按 `updatedAt` 降序（可扫性对齐 Grok group_priority）。

标题：`会话舰队 · Session Dashboard`  
页脚：`↑/↓ 选择 · Enter 恢复 · Esc 取消 · /dashboard web 开 Web`  
空态：`尚无会话 — 在下方输入开始第一轮对话`

入口统一：

- `/sessions` · `/resume`（无参）· `Ctrl+\` → 舰队
- `/dashboard`（无参 / `tui`）→ **同舰队**（对标 Grok `/dashboard` ≡ 会话总览）
- `/dashboard web|url|open` → 打印 Web Mission Control 链接（旧行为）

### G4.3 双向深链

| 方向 | 行为 |
|------|------|
| Web → TUI | 每条 session chip 显示 `qling --resume <id>`（可复制 title） |
| TUI → Web | `/dashboard web` 输出 loopback URL + 是否监听 |

### G4.4 空态与引导

- TUI 舰队 0 条：引导对话，不报错
- Web 0 session：中文空态 +「TUI 对话后出现」
- Web 0 task：保留「可用 /mission 或 /loop」

---

## 3. 非目标（本轮不做）

- 真 `ActiveView` / alternate-screen 全屏 Dashboard
- pin / reorder 持久化 / worktree 分组
- 多 agent 同进程 attach 与 roster 轮询
- Subagent 独立行
- 从 Web 远程 resume（仍只读 + 深链）

---

## 4. 验收标准

1. 有 ≥1 会话时，`/dashboard` 打开舰队浮层（非仅打印 URL）
2. 行含状态图标 + 次行元数据；当前会话高亮
3. Enter 调用既有 `onSessionPick` → restore
4. `/dashboard web` 仍打印 Mission Control 状态
5. Web sessions 条展示 `qling --resume …`
6. 空会话/空任务空态文案正确
7. 既有 g1 session picker / overlay / dashboard smoke 不回归
8. `npm run build` + 相关 unit 通过

---

## 5. 文件落点（预期）

| 路径 | 作用 |
|------|------|
| `src/tui/session-fleet.ts` | 状态分类 · 排序 · 行格式（纯函数） |
| `src/tui/overlay-panel.ts` | 舰队面板标题/空态/次行 |
| `src/commands/dashboard.ts` | 双入口 tui \| web |
| `src/dashboard/client.ts` + `page.ts` | 深链与空态 |
| `src/dashboard/types.ts` | 可选 `resumeHint` 字段 |
| `tests/unit/session-fleet*.mjs` 等 | 单测 |
