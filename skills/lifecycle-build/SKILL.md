---
name: lifecycle-build
description: 按计划增量实现：小步修改、每步可验证。触发：开始写代码、实现功能。
tags: [lifecycle, build, implement]
triggers: [实现, 编码, 写代码, /build]
---

# 生命周期 · 实现（Build）

## 步骤

1. 只实现 **当前计划中的下一步**，不偷跑范围外需求。
2. 优先 `read` / `search` 理解现有模式，再 `patch`/`write`。
3. 每完成一步：跑最小相关测试或命令；失败先修再前进。
4. 保持 diff 小而可读；大文件用 patch。
5. 进度用 todo 标记；中断可 checkpoint。

## 不要

- 不要无读就大范围改。
- 不要静默吞掉测试失败。
- 不要在 Plan Mode 下写文件（先 `/plan off`）。
