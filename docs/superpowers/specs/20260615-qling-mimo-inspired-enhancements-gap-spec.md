# 轻灵（Qling）深度优化补遗技术规范 (Gap Spec)

针对 20260615 规格/计划原文对比验收中发现的 4 项未完整落地功能进行补遗与闭环设计。

---

## 1. 规范一：Patch 工具成功时输出 Unified Diff

### 1.1 目标与设计
在 `patch` 工具执行成功并写入文件后，将文件的修改前后差异以标准的 Unified Diff 格式输出，而不仅仅是返回一条成功消息。

### 1.2 差异生成算法 (LCS Diff)
为避免引入庞大的外部 npm 依赖，在 `src/tools/patch.ts` 中实现一个轻量、高效的行级 Longest Common Subsequence (LCS) 差异生成算法：
1. **LCS 动态规划**：计算修改前 `originalLines` 与修改后 `newLines` 的 LCS 矩阵，回溯得到包含 `same`、`add`、`delete` 的差异条目数组。
2. **Hunk 分组 (与 Git par 对齐)**：
   - 设定上下文行数 `contextLines = 3`。
   - 当遇到非 `same` 的变动行时，向上和向下合并 3 行 context。
   - 若两个变动行间隔的 `same` 行数小于等于 `contextLines * 2`（即 6 行），合并为同一个 Hunk。
3. **格式化输出**：
   - 输出以 `--- <filepath>` 和 `+++ <filepath>` 开头。
   - 每个 Hunk 以 `@@ -originalStart,originalCount +newStart,newCount @@` 标记，并以 ` ` (same), `-` (delete), `+` (add) 为行前缀。

---

## 2. 规范二：Search 工具 10k Native 遍历上限

### 2.1 目标与设计
当 Ripgrep 与 Git grep 不可用，降级到 Native Node.js 遍历搜索时，若项目体量过大，可能会导致 CPU 挂死或内存超限。必须施加严格的 traversal budget，上限为 10,000。

### 2.2 限制机制
1. **计数与超限判定**：
   - 在 `walkFiles` 递归/栈遍历过程中维护 `visitCount` 计数器，每访问一个文件或目录加 1。
   - 当 `visitCount > 10000` 时，中断遍历并抛出 `TRAVERSAL_BUDGET_EXCEEDED` 错误。
2. **优雅降级与警告**：
   - 在 `searchFilesNative` 和 `searchContentNative` 中捕获此错误。
   - 保留已搜索到的匹配项，并在输出末尾追加明显的警告信息：
     `⚠️ Warning: Search traversal budget of 10,000 files was exceeded. Results may be incomplete.`

---

## 3. 规范三：Search 工具增加 Git Grep Fallback

### 3.1 目标与设计
若本地没有全局的 `rg` 命令行工具，且当前项目是 Git 仓库，应优先通过 Git 命令行工具执行毫秒级搜索，而不是直接降级到性能低下的 Native 遍历。

### 3.2 判定与流程
在 `runSearch` 中建立三层搜索流水线：
1. **第一层：Ripgrep** (`rg` 优先)
2. **第二层：Git grep / Git ls-files** (新增)
   - 若 `target === "files"`，运行 `git ls-files`，在返回的文件名中过滤 `pattern`（满足 glob 语义）以及 `file_glob`。
   - 若 `target === "content"`，运行 `git grep -n -I --no-color -e <pattern>` (如果 context > 0 则追加 `-C <context>`)，并解析其输出（`file:line:content` 与 `file-line-content`）。
   - 若执行出错或退出码非 0/1（如非 Git 仓库，退出码为 128），无缝降级到第三层。
3. **第三层：Node.js Native 遍历**

---

## 4. 规范四：Repo Map 自动注入与 Prompt Cache 对齐

### 4.1 目标与设计
通过 `/repomap` 生成的项目符号地图，必须在 Agent 规划或对话阶段自动装配到 System Prompt 中，以作为全局符号导航的上下文，并优化 Prompt Caching 的排序。

### 4.2 符号获取
在 `src/memory/cognitive-index.ts` 中新增 `getAllSymbols()` 方法，从 `kg_nodes` 检索所有已索引的符号，按 `文件名 -> 符号列表` 整理。

### 4.3 Prompt 段落排序与缓存
1. **插入位置**：
   在 `src/pipeline/sections.ts` 中新增 `REPOMAP` 节，默认作为静态段落注册在 `TONE`（风格）段落之后、`SESSION`（动态会话）段落之前。
2. **排序优势**：
   - 静态部分：`INTRO` -> `TOOLS` -> `WORKFLOW` -> `RESTRICTIONS` -> `TONE` -> `REPOMAP`
   - 动态部分：`SESSION` -> `MEMORY` -> `TOKEN_BUDGET`
   使得所有长且稳定的内容在前，动态小内容在后，完美对齐 LLM 的 Prompt Cache 机制，最大化缓存命中率，节约开销。
3. **动态注入**：
   在 `src/agent-loop.ts` 的 `buildSystemPrompt` 执行时，自动从 `CognitiveIndex` 获取最新符号并将其 `register` 注入到 `sectionRegistry`，自动替换之前的 Repo Map 占位。
