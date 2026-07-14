# 主循环 / System Prompt 抽出收口

**日期**: 2026-07-14  
**状态**: 完成  

## 模块

| 模块 | 路径 |
|------|------|
| System prompt | `src/agent/system-prompt.ts` — `assembleSystemPrompt` / `reflectiveThink` / runtime meta |
| Main loop | `src/agent/main-loop.ts` — `runOuterAgentLoop` / `runInnerIterationLoop` |

## 体量

- `agent-loop.ts`：约 **1262 → 1023** 行
- AgentLoop 现为：构造/init + 依赖装配 + 薄委托

## 证据

```text
npm run ci:check → exit 0 (unit 843 pass)
```
