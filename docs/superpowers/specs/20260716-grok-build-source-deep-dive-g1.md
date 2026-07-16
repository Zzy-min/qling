# Grok Build 源码深潜 → 轻灵 G1 加深

**源仓库**: https://github.com/xai-org/grok-build  
**关键路径**: `crates/codegen/xai-grok-pager/src/app/agent_view/*`  
**日期**: 2026-07-16  

---

## 1. Grok 输入架构（源码事实）

### 1.1 三级冒泡（`agent_view/mod.rs` 文档）

```
key press
  → overlays / modals 先抢 Esc
  → 1. pane 级
       prompt focused:
         prompt.handle_key → Submit | Edited | Ignored
         Ignored → registry.lookup(key, PromptFocused)
         仍无匹配 → Tab 结构动作 FocusScrollback
       scrollback focused:
         Space/i → FocusPrompt
         registry.lookup(key, ScrollbackFocused) → 导航
  → 2. agent 级（pane 返回 Unchanged）
       CancelTurn (Ctrl+C 两步)、ToggleYolo、NextModel
  → 3. Esc 策略（独立于 vim/simple）
  → 4. Unchanged → app 全局（quit）
```

**对轻灵含义**: 不能继续把所有键塞进一个巨大的 `if (seq === ...)` 而无 **焦点状态**。  
G1 加深引入 `TuiFocus = prompt | scrollback` + 浮层 owner。

### 1.2 双焦点（`panes.rs`）

Scrollback 焦点下：

- `Tab` / `Space` / `i`(vim) → `Action::FocusPrompt`
- `Enter` 在选中 **UserPrompt** 上 → 进入 inline edit
- 其余走 `ActionRegistry`（`When::ScrollbackFocused`）

Prompt 焦点下：

- 注册表优先（SendPrompt、FocusScrollback）
- 再落到 textarea 编辑

### 1.3 Jump 选择器（`dispatch/jump.rs` + `agent_view/jump.rs`）

```rust
// 打开时捕获视口书签
JumpRestore {
  bookmark: scrollback.capture_scroll_bookmark(),
  selected: scrollback.selected(),
  follow_mode: scrollback.is_follow_mode(),
}
// 预览：光标移动时 scroll_to_entry_top
// Enter：jump_to_entry(prompt_id)
// Esc：restore_jump_viewport — 失败 jump 也不搁浅
// jump_slot_taken：rewind / inline_edit / btw / permission 占用时禁止打开
```

**对轻灵含义**: 浮层必须有 **restore 快照**；多浮层互斥（`jump_slot_taken`）。

### 1.4 Dashboard（`dispatch/dashboard.rs`）

- 独立 `ActiveView`，持久化 pin/reorder/grouping
- 从 `agents` 表构建行，非「当前 scrollback 的简单列表」
- attach / rename / stop / dispatch 都是 **dispatch Effect**，不是直接改 UI

### 1.5 Action 表（`actions/defaults.rs`）

> All key bindings are defined here — not scattered across event handlers.

`When::ScrollbackFocused | PromptFocused | AgentScreen | Dashboard | ...`  
`hint_priority` 驱动底部 hint 条。

### 1.6 Session（`session.rs`）

- `AgentView` 绑定 `session_id`，切换时 reset reconnect cursor / event highwater  
- `note_self_originated_prompt` 区分本客户端发起的 turn  
- `new(session, scrollback)` 组合数据与视图  

### 1.7 Prompt 历史（`prompt.rs`）

`combined_prompt_history`：**scrollback 中 UserPrompt 块优先**（最新在前），再合并持久化 history —— 防止异步加载 race 丢刚发的 prompt。

---

## 2. 与轻灵 G1 现状对照

| Grok 机制 | 轻灵 G1 v1 | 加深后 |
|-----------|------------|--------|
| Prompt/Scrollback 双焦点 | 仅有 overlay 开关 | `focus-model.ts` + Tab/Space 语义 |
| ActionRegistry | 散落 seq if | `actions.ts` 集中表 |
| JumpRestore 书签 | 无 | `JumpRestore` 打开/Esc 恢复 focus+选中 |
| jump_slot_taken | 无 | overlay owner 互斥 |
| timeline_entries | turnLog 数组 | 保留；导航走 focus=scrollback |
| Dashboard 多 agent | Web 任务板 | 不混；TUI 会话切换器学 jump+dashboard 行 |
| 真滚动 viewport | 无（append-only） | 仍用浮层预览（诚实边界） |

---

## 3. 加深实现清单（本轮代码）

1. `src/tui/focus-model.ts` — 焦点与槽占用  
2. `src/tui/actions.ts` — 动作表 + JumpRestore  
3. `StreamUI` — 接入 focus；Tab 空=进 scrollback；Space 回 prompt；打开浮层记 restore  
4. 会话列表按 `updatedAt` 降序（更接近 dashboard 可扫性）  
5. 单测 focus/actions  

---

## 4. 后续仍属 Grok 级但未做

| 项 | 源码位置 | 为何延后 |
|----|----------|----------|
| 真 viewport scroll + bookmark | `ScrollbackViewport` 独立缓冲 + `turns` managed panel | 已于 2026-07-17 完成；不依赖 alternate screen |
| Enter on user prompt → inline edit | panes.rs | 要可编辑历史块 |
| Action hint 条动态渲染 | defaults hint_priority | UX 锦上添花 |
| 多 Agent ActiveView | app_view | G4 双表面 |
| mouse selection | selection.rs | 工作量大 |

---

## 5. 架构建议（G1.5 轻量）

Grok 的未来拆分（源码注释）：

```
AgentData — entries, session, tracker
AgentViewState — scroll, selection, folds
```

轻灵等价：

```
session + turnLog + tool blobs     → 数据
focus + overlay + JumpRestore      → 视图状态
StreamUI 渲染                      → 展示
StreamingREPL                      → 副作用（restoreSession）
```

不要在 `agent-loop` 里长 UI 状态。
