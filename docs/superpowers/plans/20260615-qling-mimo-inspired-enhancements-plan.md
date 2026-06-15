# 轻灵（Qling）深度优化实施计划（Plan）
## —— 借鉴 MiMo-Code / Aider 的五步落地计划

本计划旨在落实 [20260615-qling-mimo-inspired-enhancements-spec.md](file:///C:/Users/Lenovo/projects/qling/docs/superpowers/specs/20260615-qling-mimo-inspired-enhancements-spec.md) 中的五项工程级改进，分步骤进行模块化演进和测试验证。

---

## 1. 实施步骤

### 阶段一：高频基础工具链升级 (P0)
1. **新建并注册 `patch` 工具**：
   - 新增 `src/tools/patch.ts`，实现基于 `search-and-replace` 块的精准替换逻辑。对于定位冲突，向大模型反馈清晰的上下文冲突提示。
   - 在 `src/tools/index.ts` 中注册 `patchTool`，并为模型提供示例 prompt 指引。
   - 新增 `tests/unit/patch.test.mjs` 测试块定位、替换和冲突逻辑。
2. **优化 `search` 原生遍历性能**：
   - 修改 `src/tools/search.ts` 中的 `walkFiles` 函数，硬编码默认跳过 `node_modules`、`.git` 等静态及依赖目录。
   - 添加简单的 `.gitignore` 解析逻辑，过滤符合规则的文件路径。
   - 新增 `tests/unit/search_perf.test.mjs` 冒烟测试搜索大型项目的响应时间。

### 阶段二：仓库地图与全局符号检索 (P1)
3. **符号解析与数据库映射**：
   - 创建 `src/utils/symbol-extractor.ts`，基于正则对 JS/TS/Python 的 Class 和 Function 进行基本提取。
   - 在 `src/memory/cognitive-index.ts` 中，使用 `kg_nodes` 存储提取的符号定义。
   - 增加 `/repomap` 命令行指令，输出项目结构地图；将精炼版地图自动装配到 System Prompt 的特定段落中。

### 阶段三：测试反馈与自愈闭环 (P1-P2)
4. **验证命令配置与拦截**：
   - 新增 `/verify` 命令和 slash 处理器（如 `/verify set "npm run build"`）。
   - 在 `src/agent-loop.ts` 的工具执行完成（Post-Tool Execution）生命周期中插入校验。
   - 捕获命令失败时的 stdout/stderr 输出，并自动追加至 `Message` 历史中，触发 Agent 自检自愈循环，直至编译成功或重试达 3 次上限。

### 阶段四：上下文 Token 压缩与折叠 (P2)
5. **代码骨架折叠逻辑**：
   - 扩展 [context-compactor.ts](file:///C:/Users/Lenovo/projects/qling/src/context-compactor.ts)，在压缩（`/compact`）触发时，对未发生变动的大型代码文件执行骨架折叠，保留结构骨架并省略方法内部实现。
   - 梳理 Prompt 发送流水线，保证系统提示词（System Section）及 Repo Map 位于前列，启用缓存断点。

---

## 2. 风险控制与回归验证

- **工具行为安全**：`patch` 修改代码前需读取源文件做存在性校验，不执行空路径或危险敏感路径的修改。
- **搜索防卡死保障**：如果项目文件数超过 10,000，限制 Node.js 遍历的总步数，防止爆栈；如系统支持 `rg` 则无缝降级使用。
- **防止自愈死循环**：自愈轮次（Self-healing Turn Count）必须在配置中被强制硬限（最多 3 轮），防止在有无法解决的底层错误时无限消耗 Token。
- **单元测试保障**：在每个阶段代码实现前，先写测试用例断言新逻辑的行为，实现后确保通过 `npm run ci:check` 本地回归。
