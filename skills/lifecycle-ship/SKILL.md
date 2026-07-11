---
name: lifecycle-ship
description: 发布就绪：版本、CHANGELOG、文档、回滚。触发：准备发版、npm publish、上线。
tags: [lifecycle, ship, release]
triggers: [发布, ship, 发版, /ship]
---

# 生命周期 · 发布（Ship）

## 清单

1. **验证绿**：build / 相关测试 / eval:smoke。
2. **CHANGELOG**：用户可见变更用完整句子。
3. **版本**：与 package.json / 可见 badge 一致。
4. **文档**：README / skills / install 是否需更新链接。
5. **回滚**：如何退回上一版本或关闭新 env 开关。
6. **密钥**：无明文 key 进入仓库。

## 不要

- 不要在红测状态下声称可发布。
- 不要把实验性破坏变更伪装成 patch。
