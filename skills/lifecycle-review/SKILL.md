---
name: lifecycle-review
description: 合并前代码健康检查：正确性、安全、可维护性。触发：准备提交、CR、/review。
tags: [lifecycle, review, quality]
triggers: [代码审查, review, 合并前, /review]
---

# 生命周期 · 审查（Review）

## 五轴快速检查

1. **正确性**：是否满足 Spec 验收？边界？
2. **安全**：密钥、注入、路径穿越、危险 bash？
3. **可维护性**：命名、重复、文件是否过大？
4. **可观测/错误**：失败是否诚实、是否吞异常？
5. **测试**：关键路径是否有证据？

## 输出

- CRITICAL / HIGH / MEDIUM / LOW 列表 + 建议修复顺序。
- 无问题也写「已核对验收条款」。

## 不要

- 不要只夸「看起来不错」而无检查清单。
