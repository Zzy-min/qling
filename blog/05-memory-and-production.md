# 从零搭建轻灵（五）：记忆系统与生产化特性

> 这是「从零搭建轻灵」系列的最后一篇。我们实现让 Agent 真正「有记忆」的系统，以及 Mission、Daemon、Dashboard 等生产级特性。

## 三层记忆架构

轻灵的记忆分三层，从短到长：

```
┌─────────────────────────────────────┐
│  Layer 1: Scratchpad（草稿本）       │
│  - 当前对话的上下文                  │
│  - 存在内存中                       │
│  - 对话结束即丢失                    │
├─────────────────────────────────────┤
│  Layer 2: Conversation（对话记忆）   │
│  - 本次会话的所有交互                │
│  - 支持压缩和摘要                    │
│  - 会话结束即丢失                    │
├─────────────────────────────────────┤
│  Layer 3: Persisted（持久记忆）      │
│  - SQLite 数据库存储                 │
│  - 支持向量语义搜索                  │
│  - 跨会话持久存在                    │
└─────────────────────────────────────┘
```

## Scratchpad：当前上下文

就是 Agent Loop 的 `messages` 数组：

```typescript
class AgentLoop {
  private messages: Message[] = [];

  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }

  // 每轮 LLM 调用都带上完整 messages
  async callLLM(): Promise<Message> {
    const response = await this.client.post("/chat/completions", {
      messages: [
        { role: "system", content: this.systemPrompt },
        ...this.messages
      ],
    });
    return response.data.choices[0].message;
  }
}
```

## Conversation：对话压缩

当 Token 预算耗尽时，把旧消息压缩成摘要：

```typescript
class ContextCompactor {
  private keepRecent = 6;
  private threshold: number;

  async compact(messages: Message[]): Promise<Message[]> {
    // 判断是否需要压缩
    const totalTokens = this.estimateTokens(messages);
    if (totalTokens < this.threshold) return messages;

    // 保留最近的消息
    const oldMessages = messages.slice(0, -this.keepRecent);
    const recentMessages = messages.slice(-this.keepRecent);

    // 用 LLM 总结旧消息
    const summary = await this.summarize(oldMessages);

    // 确保 tool_call → tool_result 链完整
    const safeRecent = this.ensureToolChain(recentMessages);

    return [
      { role: "user", content: `[上下文摘要] ${summary}` },
      ...safeRecent
    ];
  }

  private async summarize(messages: Message[]): Promise<string> {
    const response = await this.client.post("/chat/completions", {
      model: this.model,
      messages: [
        { role: "system", content: "请用中文总结以下对话的关键信息，保留所有重要的文件路径、命令和决策。" },
        ...messages
      ],
      max_tokens: 500,
    });
    return response.data.choices[0].message.content;
  }

  // 关键：保护 tool_call 链的完整性
  private ensureToolChain(messages: Message[]): Message[] {
    if (messages.length < 2) return messages;

    // 如果第一条是 tool_result，需要找到对应的 tool_call
    if (messages[0].role === "tool") {
      let i = 1;
      while (i < messages.length && messages[i].role !== "assistant") {
        i++;
      }
      // 从 assistant（带 tool_calls）开始保留
      return messages.slice(i - 1);
    }
    return messages;
  }
}
```

**⚠️ 关键陷阱**：如果 `recentKeep` 截断了 `assistant(tool_calls)` 但保留了 `tool_result`，API 会报错。必须成对保留。

## Persisted：SQLite 持久记忆

```typescript
// memory.ts
import Database from "better-sqlite3";

class MemoryStore {
  private db: Database.Database;

  constructor(memoryDir: string) {
    const dbPath = path.join(memoryDir, "memories.db");
    this.db = new Database(dbPath);

    // 创建记忆表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        content TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        access_count INTEGER DEFAULT 0
      )
    `);
  }

  // 保存记忆
  save(key: string, content: string, metadata?: any): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO memories (key, content, metadata)
      VALUES (?, ?, ?)
    `).run(key, content, JSON.stringify(metadata));
  }

  // 关键词搜索
  search(query: string, limit: number = 5): Memory[] {
    return this.db.prepare(`
      SELECT * FROM memories
      WHERE content LIKE ?
      ORDER BY access_count DESC, created_at DESC
      LIMIT ?
    `).all(`%${query}%`, limit);
  }

  // 更新访问计数
  touch(key: string): void {
    this.db.prepare(`
      UPDATE memories
      SET accessed_at = CURRENT_TIMESTAMP, access_count = access_count + 1
      WHERE key = ?
    `).run(key);
  }
}
```

## 向量语义记忆

v0.3 引入了基于向量的语义搜索：

```typescript
// memory/embedding.ts
class EmbeddingClient {
  private endpoint: string;
  private apiKey: string;
  private model: string;

  async embed(text: string): Promise<number[]> {
    const response = await axios.post(
      `${this.endpoint}/embeddings`,
      {
        model: this.model, // "text-embedding-3-small"
        input: text,
      },
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      }
    );
    return response.data.data[0].embedding;
  }
}

// memory/cognitive-index.ts
class CognitiveIndex {
  private db: Database.Database;

  async indexMemory(id: number, content: string, embedding: number[]): Promise<void> {
    // 存储向量（用 SQLite + 简单的 JSON 列）
    this.db.prepare(`
      INSERT INTO memory_vectors (memory_id, embedding)
      VALUES (?, ?)
    `).run(id, JSON.stringify(embedding));
  }

  async queryByVector(queryEmbedding: number[], topK: number = 5): Promise<number[]> {
    const allVectors = this.db.prepare("SELECT memory_id, embedding FROM memory_vectors").all();

    // 余弦相似度计算
    const scored = allVectors.map((row) => ({
      id: row.memory_id,
      score: this.cosineSimilarity(queryEmbedding, JSON.parse(row.embedding)),
    }));

    // 按相似度排序
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.id);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
```

**三路检索模式**：
1. 关键词匹配（LIKE 查询）
2. 向量语义搜索（余弦相似度）
3. 时间衰减（最近访问的优先）

## WAL：崩溃恢复

Write-Ahead Log 确保记忆写入不会因崩溃丢失：

```typescript
// memory/wal.ts
class WriteAheadLog {
  private walDir: string;
  private entries: WALEntry[] = [];

  async append(entry: WALEntry): Promise<void> {
    // 1. 先写 WAL 文件（顺序写，快）
    const walFile = path.join(thisWalDir, `wal-${Date.now()}.jsonl`);
    await fs.appendFile(walFile, JSON.stringify(entry) + "\n");
    this.entries.push(entry);
  }

  async flush(): Promise<void> {
    // 2. 批量写入 SQLite（随机写，慢）
    for (const entry of this.entries) {
      await this.applyToDB(entry);
    }
    // 3. 清理 WAL 文件
    this.entries = [];
    await this.clearWALFiles();
  }

  async recover(): Promise<void> {
    // 启动时重放未完成的 WAL
    const walFiles = await fs.readdir(this.walDir);
    for (const file of walFiles.filter(f => f.endsWith(".jsonl"))) {
      const content = await fs.readFile(path.join(this.walDir, file), "utf-8");
      for (const line of content.split("\n").filter(Boolean)) {
        const entry = JSON.parse(line);
        await this.applyToDB(entry);
      }
    }
  }
}
```

## Mission 系统

Mission 让 Agent 能处理**跨会话的长任务**：

```typescript
// mission/types.ts
interface Mission {
  id: string;
  name: string;
  description: string;
  status: "queued" | "running" | "succeeded" | "failed" | "paused" | "cancelled";
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  error?: { code: string; message: string };
}

// mission/manager.ts
class MissionManager {
  private missions: Map<string, Mission> = new Map();

  async createMission(name: string, description: string): Promise<Mission> {
    const mission: Mission = {
      id: "mission-" + Date.now(),
      name,
      description,
      status: "queued",
      sessionId: "session-" + Date.now(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.missions.set(mission.id, mission);
    await this.persist(mission);
    return mission;
  }

  async updateStatus(id: string, status: Mission["status"]): Promise<void> {
    const mission = this.missions.get(id);
    if (mission) {
      mission.status = status;
      mission.updatedAt = new Date().toISOString();
      await this.persist(mission);
    }
  }
}
```

CLI 用法：

```bash
# 创建并执行任务
qling mission start "重构认证模块，添加 JWT 支持"

# 查看任务列表
qling mission list

# 查看任务详情
qling mission show <id>

# 查看任务日志
qling mission logs <id>

# 暂停/恢复/取消
qling mission pause <id>
qling mission resume <id>
qling mission cancel <id>
```

## Daemon 守护进程

Daemon 让任务在后台运行，关掉终端也不影响：

```typescript
// daemon.ts
import express from "express";

const app = express();
app.use(express.json());

// 提交任务
app.post("/missions", async (req, res) => {
  const mission = await missionManager.createMission(req.body.name, req.body.description);

  // 异步执行（不阻塞响应）
  executeLocalMission(agent, missionManager, mission).catch(console.error);

  res.json({ missionId: mission.id });
});

// 查询任务状态
app.get("/missions/:id", async (req, res) => {
  const mission = await missionManager.getMission(req.params.id);
  res.json(mission);
});

app.listen(9998, () => {
  console.log("qlingd listening on :9998");
});
```

## Dashboard 观测台

内置 Web 控制台，可视化 Agent 的执行过程：

```typescript
// dashboard-server.ts
class DashboardServer {
  private app: express.Express;

  constructor(config: { port: number; collector: MetricsCollector }) {
    this.app = express();

    // 提供静态文件
    this.app.use(express.static(path.join(__dirname, "dashboard")));

    // API：获取指标
    this.app.get("/api/metrics", (req, res) => {
      res.json(config.collector.getMetrics());
    });

    // API：获取工具调用历史
    this.app.get("/api/tool-calls", (req, res) => {
      res.json(config.collector.getToolCalls());
    });
  }
}
```

在浏览器打开 `http://localhost:9999` 即可查看：
- 工具调用耗时图表
- Token 消耗趋势
- 错误率统计
- 实时日志流

## MCP 客户端

Model Context Protocol 让轻灵能接入外部工具：

```typescript
// mcp/client.ts
class MCPClient {
  private process: ChildProcess;

  async connect(serverConfig: MCPServerConfig): Promise<void> {
    // 通过 stdio 启动 MCP 服务器
    this.process = spawn(serverConfig.command, serverConfig.args);

    // 发送初始化请求
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "qingling", version: "0.5.0" },
    });
  }

  async listTools(): Promise<MCPTool[]> {
    const response = await this.sendRequest("tools/list", {});
    return response.tools;
  }

  async callTool(name: string, args: any): Promise<any> {
    return await this.sendRequest("tools/call", { name, arguments: args });
  }
}
```

配置 MCP 服务器：

```bash
# .env
QINGLING_MCP_SERVERS='{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
    "enabled": true
  }
}'
```

## 完整的生产化特性清单

| 特性 | 版本 | 说明 |
|------|------|------|
| 三层记忆架构 | v0.2 | Scratchpad → Conversation → Persisted |
| WAL 崩溃恢复 | v0.2 | 写前日志，启动时重放 |
| 向量语义搜索 | v0.3 | SQLite + 余弦相似度 |
| MCP 协议 | v0.2 | 接入外部工具服务器 |
| Mission 系统 | v0.5 | 跨会话长任务管理 |
| Daemon 守护进程 | v0.5 | 后台执行，关终端不影响 |
| Dashboard | v0.3 | Web 可观测台 |
| Guard 安全 | v0.1 | 审批、过滤、权限、速率限制 |
| Onboarding | v0.4 | 交互式配置向导 |
| Slash 命令 | v0.4 | `/compact`, `/status`, `/clear` 等 |

## 总结

五篇博客走下来，你已经了解了轻灵的全部核心：

1. **架构**：模块化设计，Agent Loop 是唯一协调者
2. **Agent Loop**：ReAct 循环，Tool Calling，Token 预算
3. **TUI**：ANSI 控制，追加式输出，CJK 宽度
4. **工具与 Pipeline**：可插拔工具，Hook/Section/Verification
5. **记忆与生产化**：三层记忆，向量搜索，Mission/Daemon/Dashboard

下一步你可以：
- `git clone` 然后从 v0.1 开始自己搭建
- 在现有基础上添加新工具
- 接入自己的 LLM API
- 把 TUI 改成你喜欢的风格

代码在 https://github.com/Zzy-min/qingling，欢迎 Star 和 PR。

---

*上一篇：[从零搭建轻灵（四）：工具系统与 Pipeline](./04-tools-and-pipeline.md)*
