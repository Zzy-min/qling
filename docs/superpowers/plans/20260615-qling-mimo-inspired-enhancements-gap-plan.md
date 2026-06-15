# 轻灵（Qling）深度优化补遗实施计划 (Gap Plan)

本计划旨在落实 [20260615-qling-mimo-inspired-enhancements-gap-spec.md](file:///C:/Users/Lenovo/projects/qling/docs/superpowers/specs/20260615-qling-mimo-inspired-enhancements-gap-spec.md) 中的 4 项补遗演进。

---

## 1. 实施步骤

### 阶段一：Patch Unified Diff 输出与测试
1. **实现 Diff 生成器**：
   - 在 `src/tools/patch.ts` 中实现 `generateUnifiedDiff(filePath, original, modified)` 差异算法。
   - 替换 `runPatch` 的成功返回，从普通消息改为附带 Unified Diff 输出。
2. **测试验证**：
   - 更新 `tests/unit/patch.test.mjs`，断言成功应用补丁后，输出内容包含 `---`、`+++`、`@@` 及具体变动行。

### 阶段二：Search Native 遍历限制与 Git Grep Fallback
3. **安全防卡死 (Native Limit)**：
   - 修改 `src/tools/search.ts` 中的 `walkFiles` 函数，添加 `visitCount` 计数并硬限制为 10,000；抛出特定异常。
   - 在 `searchFilesNative` 和 `searchContentNative` 中捕获并呈现警告后缀。
4. **Git Grep 降级链**：
   - 在 `src/tools/search.ts` 中实现 `searchWithGitGrep` 函数，集成 `git ls-files` (文件名过滤) 与 `git grep` (内容匹配)。
   - 在 `runSearch` 中将 `searchWithGitGrep` 串联在 `searchWithRipgrep` 之后。
   - 修复 `searchWithRipgrep` 在 `target === "files"` 下未能通过 `pattern` 过滤文件名之缺陷。
5. **性能测试独立化**：
   - 新增独立测试文件 `tests/unit/search_perf.test.mjs`，覆盖 `search` 遍历超限警告判定、Git grep Fallback 降级通路。

### 阶段三：Repo Map 自动装配与 Prompt 缓存对齐
6. **读取符号数据库**：
   - 修改 `src/memory/cognitive-index.ts`，新增 `getAllSymbols()` 方法，以关联查询从 `kg_nodes` 与 `kg_edges` 中拉取完整符号列表。
7. **注册与排布**：
   - 修改 `src/pipeline/sections.ts`：
     - 在 `SECTION_IDS` 中增加 `REPOMAP: "repomap"`。
     - 增加 `buildRepoMapSection(symbols)` 段落构建函数。
     - 在 `buildDefaultRegistry` 中，将 `buildRepoMapSection([])` 的占位符注册在 `TONE`（风格）段落之后、`SESSION`（动态会话）段落之前。
8. **动态刷新**：
   - 修改 `src/agent-loop.ts`：
     - 导入 `buildRepoMapSection`。
     - 在 `buildSystemPrompt()` 内，获取 `CognitiveIndex`，调用 `getAllSymbols()`，随后以 `this.sectionRegistry.register(...)` 动态更新 `repomap` section。

---

## 2. 验证与回归

- **本地测试验证**：运行 `npm run build && npm run ci:check`，确保 578 项单元测试和 56 项 smoke 测试全部通过。
- **Lint 校验**：使用 `git diff --check` 确保未引入多余的尾随空格。
