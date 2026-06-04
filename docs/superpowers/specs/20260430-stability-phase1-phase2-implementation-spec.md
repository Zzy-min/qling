# `qling` 稳定性优先落地设计（实施版）

## 目标
- 将已识别的 `search` 与 `context-compactor` 高风险回归固化为自动化测试。
- 引入最小测试体系，不增加第三方测试依赖。
- 为 `search/read/write/bash` 统一错误语义（`Error: [CODE] message`），并补充边界校验。
- 为 `agent-loop` 增加轻量观测日志，覆盖工具调用、失败率、压缩触发与重试次数。
- 输出风险与防回归文档，作为后续扩展（多代理/RAG）前门禁。

## 设计决策
1. 测试栈：`node:test` + `node:assert/strict`，测试文件使用 `.mjs`，直接调用 `dist` 产物。
2. 脚本接口：新增 `npm test`、`npm run test:smoke`；`npm test` 默认执行单测与基础回归。
3. 错误语义：工具层采用统一编码输出，保持 `Error:` 前缀兼容现有消费方。
4. 边界策略：
   - `search`: 空 pattern、非法 regex、过大文件跳过、limit/context clamp。
   - `read`: 路径与读取边界校验，超大文件阻断，二进制文件阻断。
   - `write`: 路径校验、危险路径阻断、超大内容阻断。
   - `bash`: 命令与 timeout 校验，cwd 校验，输出缓冲上限与截断。
5. 观测策略：每轮输出一条聚合日志，不持久化，仅用于可观测和排障。

## 非目标
- 不迁移到 LangGraph/CrewAI。
- 不新增重型 observability 基础设施（metrics backend、trace store）。
- 不改动 CLI 用户侧行为和主要命令参数。

## 验收标准
- `npm run build`、`npm test`、`npm run test:smoke` 全通过。
- P1 回归场景转为固定测试并可重复运行。
- README 出现“稳定性保障”章节，包含执行命令与门禁说明。
