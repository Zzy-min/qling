---
name: fix-failing-test
description: 定位并修复失败的单元测试：读错误、最小改动、再跑验证
tags: [example, testing, coding]
triggers: [修测试, failing test, unit test, 红灯, assert]
---

# Fix Failing Test

## 何时使用

用户说「测试挂了」「帮我修这个 unit test」「红了」时加载。

## 步骤

1. **复现** — 用 `bash` 跑失败命令（`npm test` / `node --test path`），保存完整错误
2. **定位** — `read` 失败文件与被测实现；`search` 相关符号
3. **假设** — 区分「断言错了」vs「实现错了」vs「环境/路径」
4. **最小修复** — `patch` 只改必要行；避免无关重构
5. **验证** — 再跑同一命令；必要时补一条窄测试

## 约束

- 不要为了让测试变绿而删除断言（除非用户明确要求）
- 不要改 `.env` / 密钥文件
- Plan Mode 下只输出计划

## 验收

- [ ] 失败命令现已通过
- [ ] diff 可读、范围小
- [ ] 说明根因一句话
