---
name: lifecycle-spec
description: 在写代码前把需求收敛成可验证规格（问题、用户、约束、验收）。触发：新功能、需求不清、要写 PRD。
tags: [lifecycle, spec, planning]
triggers: [规格, PRD, 需求, 定义问题, /spec]
---

# 生命周期 · 规格（Spec）

在实现之前先冻结「做什么 / 不做什么」。

## 步骤

1. **问题一句话**：用户痛点与当前失败表现。
2. **目标用户与场景**：谁、何时、在哪用。
3. **范围内 / 范围外**：明确本轮不做。
4. **验收标准**：3–7 条可观察条件（Given/When/Then 或 checklist）。
5. **风险与依赖**：权限、数据、外部 API、Windows 差异。
6. **输出**：用 Markdown 写 `## Spec` 小节，请用户确认后再进入 plan。

## 不要

- 不要在规格未确认时直接 `write`/`patch`。
- 不要假装已理解模糊需求；缺信息就列问题清单。
