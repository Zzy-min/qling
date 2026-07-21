# Spec: TUI 审批入口（Normal / Plan）对标 Grok Build

**日期**: 2026-07-17  
**状态**: accepted  
**关联**: G3.1 Plan · G3.3 权限流水线 · Grok `19-plan-mode` / `22-permissions-and-safety`

## 问题

1. **Normal（审批/ask）模式无入口**  
   Pipeline 在 `decision=ask` 时抛 `ApprovalRequiredError`，`tool-orchestrator` 仅当 `deps.channel` 存在时才调用 `ApprovalGate.requestApproval`。  
   `resolveRunModeChannel` 只在 `run` 模式装配 channel；**chat/TUI 路径 `channel=null`**，审批被当成普通工具错误，用户看不到 Allow/Deny。

2. **Plan 模式无产品级审批出口**  
   文档要求 `/plan approve` 后实施，但交互仅为斜杠命令，无对标 Grok 的「预览 + a 批准 / s 修改 / q 退出」选项面。  
   用户切到 plan 后不知如何批准实施。

## 目标

| 模式 | 入口 | 行为（对标 Grok） |
|------|------|-------------------|
| Normal / ask | 工具触发 ask 时自动弹层 | 允许一次 · 本会话始终允许 · 拒绝；Esc/Ctrl+C=拒绝 |
| Auto | 默认不弹（mode allow） | 不变 |
| Plan | `/plan approve`（及 alias）打开选项面 | 实施计划 · 继续改计划 · 退出规划不实施 |

## 非目标

- 不实现 Grok 的 plan 文件行内 comment（`c` 键）  
- 不改变 headless `run` 的 ConsoleChannel y/n  
- 不引入 OS sandbox 变更  

## 设计

1. **`TuiChannel`**：实现 `Channel.requestApproval` → 委托 `StreamUI.requestToolApproval`。  
2. **`StreamingREPL.start`**：`agent.setChannel(new TuiChannel(ui))`。  
3. **选项面板**：复用 `showOptionPicker`；扩展 `onDismiss` + 可选单键快捷（`a`/`y` allow，`d`/`n` deny）。  
4. **allow_always**：选中后 `PermissionGrantStore.remember`（已有流水线会跳过后续 ask）。  
5. **`/plan approve`**：先弹选项面再 `setPlanMode(false)` + `setImmediatePrompt(implement…)`，避免盲批。  
6. **无 channel 兜底**：orchestrator 返回明确错误文案「无审批通道」，不伪装成通用 TOOL_ERROR。

## 验收

- [ ] chat + permission=ask 时，危险/需确认工具弹出审批面板  
- [ ] Enter 允许一次后工具继续执行  
- [ ] 「本会话始终允许」后同工具不再弹  
- [ ] Esc/拒绝后工具结果为 APPROVAL_DENIED  
- [ ] `/plan approve` 弹出三选项；选「实施」后退出 plan 并注入实施 prompt  
- [ ] 单测覆盖 TuiChannel 决策映射；build 通过  
