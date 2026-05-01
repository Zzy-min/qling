# 外部资源映射（不迁移框架）

## 输入来源
- `free-ai-agents-resources`
- `microsoft/ai-agents-for-beginners`
- OpenAI practical guide（设计原则）

## 已落地映射（本轮）
1. 工具调用前后验证：
   - `pipeline` + `verification` 保持主干，补齐回归测试和错误语义。
2. 记忆与上下文治理：
   - `context-compactor` tool chain 完整性修复 + 固化测试。
3. 失败恢复与稳定性基线：
   - `search/read/write/bash` 边界校验与统一错误码。
4. 评测意识：
   - 引入 unit + smoke 双层验证与 CI 门禁。

## 可选适配点（仅记录，不实施）
1. 可在 `pipeline` 层增加 adapter，桥接 LangGraph/CrewAI 工作流节点。
2. 保留 `agent-loop` 作为编排核心，不改为外部框架 Runtime。
3. 若未来扩展多代理，优先在现有 `ToolPipeline` 抽象上加子代理策略，不做核心迁移。
