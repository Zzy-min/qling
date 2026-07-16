# G4 双表面 Dashboard — 实施计划

**状态**: 已完成（2026-07-16）  
**规格**: `docs/superpowers/specs/20260716-g4-dual-surface-dashboard-spec.md`  
**Grok 源码依据**: `views/dashboard/{row,state,mod}.rs` · `dispatch/dashboard.rs` · `23-dashboard.md`

## 任务拆解

### T1 — session-fleet 纯函数

- 新建 `src/tui/session-fleet.ts`
- `classifySessionFleetState` / `sortSessionFleet` / `formatSessionFleetRow` / `relativeAge`
- 24h 阈值；active > idle > stale

### T2 — overlay 面板升级

- `formatSessionPickerPanel` 使用舰队行
- 标题 `会话舰队 · Session Dashboard`
- 空态引导文案
- 页脚提示 `/dashboard web`

### T3 — `/dashboard` 双入口

- 无参 / `tui` / `fleet` / `sessions` → `openSessionPicker`
- `web` / `url` / `open` / `mc` → 现有 Mission Control 文案
- help / description 更新

### T4 — Web 深链 + 空态

- `DashboardSessionSummary` 可带 `resumeCommand`
- snapshot 映射填充
- client chip 展示命令
- page hint 更新

### T5 — 测试与验证

- unit: session-fleet 分类排序
- unit: overlay 舰队标题/空态
- unit: dashboard command 路由
- build + 既有 g1/overlay/dashboard smoke

## 不做

- pin/reorder、ActiveView 全屏、subagent 行、远程 attach
