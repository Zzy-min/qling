# 轻灵 TUI 跨会话记忆系统设计规范 (2026-06-15)

## 1. 目标与背景

轻灵在长期项目开发与复杂事务交互中，随着会话次数的增加，目前的记忆方案存在以下局限性：
1. **全局项目记忆污染**：目前所有的长期记忆（`memory.json` 与 SQLite `cognitive_knowledge.db`）均存放于全局默认的 `~/.qling/memory` 下。这导致在不同工作区（如前端 Web 项目与后端 C++ 项目）中积累的开发约定和首选项混合检索，造成上下文污染。
2. **纯追加（Append）导致矛盾信息共存**：现存的 `AutoDream` 启发式记忆提取流程仅为追加式写入。当项目环境或配置发生变更时，旧有的冲突事实依然会被检索出来输送给大模型，造成上下文混淆。
3. **会话之间缺乏结构化链路**：单次会话结束后，其产出、未完事项与修改的文件并没有以结构化的方式链接到下一次会话中。

本规范借鉴了 **Mem0**（记忆实体演化图谱）和 **MemGPT/Letta**（Core-Persona-Archival 分层架构与工具自主维护模式）的设计理念，为轻灵量身定制了一套支持 **多级分域隔离、LLM 驱动冲突消解合并、会话间图谱关联** 的跨会话记忆演化方案。

---

## 2. 核心架构设计

新版记忆系统由三层存储、LLM 驱动的 Consolidation（增删改）处理管道以及会话间图谱链路组成。

```
+-------------------------------------------------------------------+
|                           User Input                              |
+-------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
|               Memory Manager & Consolidation Pipeline             |
|          (Analyzes turns, outputs ADD / UPDATE / DELETE)          |
+-------------------------------------------------------------------+
                                  |
            +---------------------+---------------------+
            |                     |                     |
            v                     v                     v
+-----------------------+ +-----------------------+ +---------------+
|     Global Memory     | |   Workspace Memory    | |Session Memory|
|  (~/.qling/.../global)| | (~/.qling/.../worksp) | | (Session JSON)|
|                       | |                       | |               |
| - User preferences    | | - Tech stack & coding | | - Goals       |
| - Global key bindings | | - Repo layout & specs | | - Checklist   |
| - General facts       | | - Symbol knowledge    | | - Local draft |
+-----------------------+ +-----------------------+ +---------------+
```

### 2.1 多级记忆分层 (Hierarchical Partitioning)

长期记忆从统一存储分裂为以下三个层级，防止项目间上下文泄露：

1. **全局用户记忆 (Global User Memory)**:
   - **存储路径**：`this.runtimeRootDir/memory/global/`
   - **内容**：用户习惯（如使用中文对话、特定编辑器偏好、默认提交消息风格等）。
   - **范围**：所有工作区和会话共有。
2. **工作区/项目记忆 (Workspace/Project Memory)**:
   - **存储路径**：`this.runtimeRootDir/memory/workspace/<workspace-hash>/`
   - **项目哈希**：对当前 `config.runtime.workspaceDir`（绝对路径）进行 SHA-256 计算并截取前 16 位字符。
   - **内容**：该项目特有的技术栈（如 C++17, React 19）、开发文档规范、仓库特有的编译测试命令、以及通过符号提取自动生成的代码库图谱。
   - **范围**：当前工作区跨会话共享，不同工作区物理目录绝对隔离。
3. **会话级记忆 (Session Memory)**:
   - **存储路径**：`this.runtimeRootDir/sessions/<session-id>/`
   - **内容**：当前具体的 Goals、正在推进的 TODO 检查清单、短期临时变量、会话笔记（Scratchpad）。
   - **范围**：单次会话私有。

---

### 2.2 LLM 驱动的记忆整理与冲突消解管道 (Consolidation Pipeline)

每次手动执行 `/dream`、`/distill` 或会话退出持久化内存时，激活 LLM 增删改整理流程，防止冗余与冲突：

1. **收集当前数据**：将当前会话的 `ConversationMemory` 最新切片、`ScratchpadMemory` 会话笔记以及已有的长期记忆列表汇总。
2. **大模型判定冲突**：通过特定的 System Prompt 指引 LLM 进行逻辑事实梳理，评估哪些是新产生的约定，哪些已失效、哪些已被推翻。
3. **结构化指令输出**：LLM 输出包含如下操作的 JSON 指令数组：
   ```typescript
   interface MemoryOperation {
     action: "ADD" | "UPDATE" | "DELETE" | "NOOP";
     fact: string;
     targetId?: string;       // 针对 UPDATE / DELETE 操作指定已有事实 ID
     reason: string;          // 理由陈述
   }
   ```
4. **事务化执行**：
   - `ADD`：计算 Embedding 向量并 upsert 存入 SQLite 的 `embeddings` 表。
   - `UPDATE`：根据 `targetId` 覆盖修改对应的事实内容，重新生成向量值，并写入 WAL 日志中。
   - `DELETE`：物理清除 SQLite 中对应的数据行，并在知识图谱中解除对应的实体边。

---

### 2.3 会话节点链路 (Session-level Graph Linkage)

会话归档退出或 `/distill` 时，在 SQLite 知识图谱（`kg_nodes` / `kg_edges` 表）中生成结构化演化关系：
- **新增图谱实体**：
  - `session` 节点：存储 `{ id: sessionId, summary: string, date: string }` 属性。
  - `task` 节点：存储 `{ id: taskId, label: string }` 属性。
- **构建关系边**：
  - `(session-id) --[executes]--> (task-id)`（执行任务）
  - `(session-id) --[modifies]--> (file:path)`（修改文件）
  - `(session-id) --[utilizes]--> (technology:name)`（应用技术）
- **优势**：下一次在相同工作区开启新会话时，Agent 自动拉取上一轮会话节点的 `summary` 属性及修改的文件作为前置背景记忆，实现完美接轨。

---

## 3. 详细数据结构与接口

### 3.1 SQLite 表结构变更
为了支持三层分层和历史回溯，SQLite 的 `embeddings` 表增加 `scope` 与 `project_path` 字段：
```sql
ALTER TABLE embeddings ADD COLUMN scope TEXT DEFAULT 'workspace'; -- 'global' | 'workspace'
ALTER TABLE embeddings ADD COLUMN project_path TEXT;
```

### 3.2 核心类接口声明
`MemoryStore` 扩展接口以支持多层读取及路由：
```typescript
export class MemoryStore {
  private globalPersisted: PersistedMemory;
  private workspacePersisted: PersistedMemory;
  private scratchpad: ScratchpadMemory;
  private conversation: ConversationMemory;

  constructor(runtimeRootDir: string, workspaceDir: string) {
    // 自动根据 workspaceDir 的 SHA-256 建立多级子目录
    this.globalPersisted = new PersistedMemory(path.join(runtimeRootDir, "memory", "global"));
    const wsHash = crypto.createHash("sha256").update(workspaceDir).digest("hex").slice(0, 16);
    this.workspacePersisted = new PersistedMemory(path.join(runtimeRootDir, "memory", "workspace", wsHash));
  }

  // 混合检索：合并全局与项目记忆，加权返回
  async getRelevant(query: string, limit = 5): Promise<PersistedEntry[]>;
}
```

---

## 4. 命令行交互增强

为了配合多层跨会话记忆，`/memory` 扩展如下子命令：

1. `/memory list [global|workspace]`：默认列出当前工作区的长期记忆。
2. `/memory add <fact> [--global]`：人工手动插入一条长期记忆事实。
3. `/memory delete <id>`：删除一条不小心记录错误的记忆事实。
4. `/memory edit <id> <new_content>`：交互式修改某条记忆的内容。
5. `/memory graph [count]`：输出由 `session -> task -> file -> technology` 串联的会话关联链路网。
