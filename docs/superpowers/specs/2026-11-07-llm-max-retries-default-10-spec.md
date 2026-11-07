# 模型调用重试次数默认调整为 10 次规范 (LLM Max Retries Default 10 Spec)

- **状态**: 草案 / 设计中
- **日期**: 2026-11-07
- **作者**: Antigravity Pair Programmer
- **影响范围**: `src/config.ts`, 关联配置与测试

---

## 1. 背景与问题定义

用户反馈：
> “模型调用重试次数设为10次，3次太短了”

### 现状分析
- 在 `src/config.ts` 中，`buildDefaultConfig()` 内硬编码设置 `llm.max_retries: 3`；
- 启动时通过 `applyConfigToProcessEnv(config)` 将 `process.env.QLING_LLM_MAX_RETRIES = String(config.llm.max_retries ?? 3)` 注入进程环境变量；
- 在模型调用（`callModelWithRetry`）中，网络抖动、网关 502/503、上游流中断（stream interrupted）等瞬态错误均以 `maxRetries` 为最大尝试上限；
- 默认 3 次重试过于保守，在代理转发、长思考流式输出或网络波动时，容易过早失败导致会话中断；
- 用户明确要求将默认重试次数提高为 10 次。

---

## 2. 方案设计

1. **更新默认配置 (`src/config.ts`)**:
   - `buildDefaultConfig().llm.max_retries` 默认值由 `3` 调整为 `10`。
   - `applyConfigToProcessEnv`: 兜底默认值由 `config.llm.max_retries ?? 3` 调整为 `config.llm.max_retries ?? 10`。
2. **环境变量兼容**:
   - 如果用户通过环境变量 `QLING_LLM_MAX_RETRIES` 或项目配置文件（`qling.config.json`）显式配置了其它值，依然优先尊重用户的显式配置；
   - 未显式配置时，默认重试次数提升至 10 次。
3. **测试与回归**:
   - 验证配置加载后的 `config.llm.max_retries` 为 10；
   - 验证环境变量注入 `QLING_LLM_MAX_RETRIES` 为 `"10"`；
   - 运行全量 `model-retry` 与配置测试，确保原有重试逻辑与回退逻辑 100% 正常。
