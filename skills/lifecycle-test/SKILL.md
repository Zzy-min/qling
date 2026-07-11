---
name: lifecycle-test
description: 用测试证明行为正确：单元优先，必要时 smoke。触发：要加测试、修 bug、验收。
tags: [lifecycle, test, tdd]
triggers: [测试, TDD, 单测, /test]
---

# 生命周期 · 测试（Test）

## 步骤

1. 明确被测行为与失败表现。
2. **先写/补失败用例**（RED），再实现到绿（GREEN）。
3. 覆盖边界：空输入、权限拒绝、Windows 路径。
4. 运行项目约定命令（如 `node --test`、`npm run eval:smoke`）。
5. 报告：通过数 / 失败 / 未覆盖风险。

## 不要

- 不要只「手动点一下」就声称完成。
- 不要为了过测而删断言。
