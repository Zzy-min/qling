# 轻灵（Qling）深度优化技术规范（Spec）
## —— 借鉴 MiMo-Code / Aider 的工程化提升方案

本项目是一份面向轻灵（Qling）的深度技术规范，旨在借鉴 **MiMo-Code** 的持久记忆与跨会话状态管理设计，以及 **Aider** 的代码级精准编辑与符号导航能力，解决轻灵在大中型复杂项目中的研发效率、Token 经济以及可靠性瓶颈。

---

## 1. 规范一：代码行/块级精准编辑工具（Patch Tool）

### 1.1 背景与痛点
轻灵当前仅提供 `write` 工具（在 [write.ts](file:///C:/Users/Lenovo/projects/qling/src/tools/write.ts) 中定义），必须传入文件完整内容，执行覆盖写入。
- **痛点**：对于超过 500 行的源文件，不仅消耗大量 Output Token，还会因为大模型的随机性导致其他未改动代码段被意外删除或破坏。

### 1.2 目标与方案
引入 `patch` 工具，允许 LLM 在不读取和重写整个文件的情况下，进行局部精准修改。
- **工具名称**：`patch`
- **参数结构**：
  - `path`: 目标文件相对/绝对路径
  - `chunks`: 替换块数组，每个块包含：
    - `search`: 要被替换的旧代码块（必须与文件内容精确匹配，包含缩进与换行）
    - `replace`: 替换后的新代码块
- **执行逻辑**：
  1. 读取文件内容。
  2. 依次寻找 `search` 块。若匹配到且唯一，执行替换；若有多个匹配或无匹配，返回具体上下文冲突行号，指示模型重新提供精确的定位。
  3. 写入文件，并将修改后的差异通过 unified diff 格式呈现给 TUI。

---

## 2. 规范二：高性能过滤与 Git-First 扫描机制

### 2.1 背景与痛点
[search.ts](file:///C:/Users/Lenovo/projects/qling/src/tools/search.ts) 目前使用原生 Node.js 的栈式深度遍历，**未自动忽略 node_modules、.git 等巨型文件夹**，会导致搜索耗时过长，且吃满 CPU。

### 2.2 目标与方案
1. **默认目录排除**：
   - 遍历逻辑默认硬编码忽略：`node_modules`、`.git`、`.qling`、`dist`、`build`、`out`、`target`、`.idea`、`.vscode`。
2. **.gitignore 解析器**：
   - 启动时和搜索时，自动读取项目根目录下的 `.gitignore` 文件，动态转换为正则，对遍历文件进行过滤。
3. **降级到系统工具**：
   - 搜索时优先检测本地是否存在 `rg`（ripgrep）或 `git grep`。若存在，自动通过子进程调用，获得毫秒级的搜索响应。

---

## 3. 规范三：轻量级仓库地图（Repo Map）与符号索引

### 3.1 背景与痛点
LLM 面对多文件项目时，无法在不读取文件内容的情况下得知“哪些类被定义在哪个文件里”、“函数在何处被调用”。Aider 通过 Tree-sitter 生成符号地图，大幅减少了不必要的文件读取。

### 3.2 目标与方案
在 `qling` 中引入轻量级的**仓库符号地图 (Repo Map)**：
1. **符号提取**：
   - 使用轻量级正则解析器或快速语法解析器，提取常见语言（TS/JS/Python/Go）的定义符号（Class, Interface, Function, Method）。
2. **地图生成**：
   - 提取格式：`文件名 -> [导出的类名, 函数名及其基本入参]`。
   - 例如：
     ```typescript
     // src/tools/patch.ts
     export function runPatch(args: { path: string, chunks: PatchChunk[] }): Promise<ToolResult>
     ```
3. **动态检索与注入**：
   - 在模型规划（`planner`）或任务执行前，将精简的 Repo Map 注入到 System Prompt 的特定 Section 中，让 LLM 在搜索前就已经掌握全局代码结构。

---

## 4. 规范四：测试与编译自愈闭环（Self-Healing Loop）

### 4.1 背景与痛点
修改代码后，如果出现语法错误或测试失败，当前流程依赖用户手动运行编译/测试并把错误结果复制给轻灵，交互阻力大。

### 4.2 目标与方案
在 [agent-loop.ts](file:///C:/Users/Lenovo/projects/qling/src/agent-loop.ts) 中集成验证与自我修正循环：
1. **配置验证命令**：
   - 允许用户通过 `/verify set <command>`（如 `npm run build` 或 `npm test`）配置项目的核心质量关卡。
2. **执行与检测**：
   - 当 Agent 修改完代码后，自动在后台运行该验证命令。
3. **报错自愈**：
   - 如果退出码非 0，Agent 自动拦截报错（stdout/stderr），并隐式开启一轮调试 turn：
     ```text
     系统提示：你刚才的修改在运行 `npm run build` 时报错：
     [Error Details]
     请分析报错信息，并使用 patch 工具修正它。
     ```
   - 设定最大自愈轮次（如 3 轮），若一直失败则提示用户接管。

---

## 5. 规范五：基于代码骨架化（Skeletonizing）的上下文折叠

### 5.1 背景与痛点
读取过的文件内容会一直全量保留在 `Message` 历史中，随着 Turn 的增加，Input Token 消耗极大，容易触及模型最大上下文窗口。

### 5.2 目标与方案
1. **代码折叠策略**：
   - 在会话被压缩（`/compact`）或超过特定 Token 阈值时，对历史消息中“已被读入但当前未修改”的文件内容进行**骨架化折叠**。
   - 将函数实现体折叠为 `// ... (remaining body folded)`，只保留函数头部，大幅节省 Token 空间。
2. **Prompt Cache 对齐**：
   - 重新梳理输入管道（`src/pipeline/`），确保静态资源（系统提示、骨架地图）排在消息历史的最前列，利用 LLM 的 Prompt Cache 机制减少费用和延迟。
