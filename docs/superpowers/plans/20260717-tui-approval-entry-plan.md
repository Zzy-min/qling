# Plan: TUI 审批入口

**Spec**: `docs/superpowers/specs/20260717-tui-approval-entry-spec.md`

## 步骤

1. 扩展 `OptionPickerSpec`：`onDismiss?`、`shortcuts?`（key → itemId）  
2. `StreamUI`：`requestToolApproval` / `requestPlanApproval` Promise API  
3. 新增 `src/channels/tui-channel.ts`  
4. `StreamingREPL.start` 挂载 TuiChannel  
5. `tool-orchestrator`：无 channel 时返回清晰 APPROVAL_CHANNEL_MISSING  
6. `/plan approve` 走 plan 审批选项面  
7. 单测 + `npm run build`  

## 风险

- Agent 执行中 `streamActive=true` 可能挡浮层 → 复用 showOptionPicker 已有 `streamActive=false` 清位  
- 并发两次 ask → ApprovalGate 已按 id 管理；UI 串行 Promise 即可  
