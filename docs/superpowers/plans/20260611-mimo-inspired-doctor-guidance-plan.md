# MiMo-Inspired Doctor Guidance Plan

## 步骤

1. 补充 `tests/unit/doctor.test.mjs`，先断言 doctor 在配置缺失、daemon 不可达和本地目录缺失时输出建议。
2. 扩展 `DoctorReport`，新增 `recommendations` 字段，由检查结果派生，不读取额外外部状态。
3. 更新 `formatDoctorReport()`，仅在存在建议时输出 `Next steps` 区块。
4. 运行定向测试和完整 `npm run ci:check`。
5. 执行旧名扫描、diff 检查、暂存检查后提交并推送。

## 风险控制

- 建议内容固定为命令或本地路径提示，不拼接原始密钥或敏感配置。
- 只改 doctor 报告，不触碰配置加载、模型调用、daemon 行为。
- 保持现有测试期望，避免把 warning 强行升级为 failure。
