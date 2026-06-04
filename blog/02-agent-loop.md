# 从零搭建轻灵（二）：Agent Loop 核心循环

> 这是「从零搭建轻灵」系列的第2篇。我们实现 Agent 的大脑——ReAct 循环。

## 什么是 Agent Loop？

Agent Loop 是一个**无限循环**，直到 LLM 返回纯文本回答（不再调用工具）为止：

```
while (未超过最大迭代次数) {
  1. 把消息列表发给 LLM
  2. 如果 LLM 返回纯文本 → 返回结果，循环结束
  3. 如果 LLM 返回 tool_calls → 执行每个工具
  4. 把工具结果追加到消息列表
  5. 继续循环
}
```

这个模式来自 Anthropic 的「Building Effective Agents」论文，也是 Claude Code、Cursor、Devin 等产品的底层原理。

## 第一步：与 DeepSeek API 交互

DeepSeek 兼容 OpenAI 的 Chat Completions API，所以我们用 axios 直接调用：

```typescript
// agent-loop.ts
private client: ReturnType<typeof axios.create>;

constructor(config: Partial<AgentConfig> = {}) {
  const endpoint = config.endpoint ?? "https://api.deepseek.com";

  this.client = axios.create({
    baseURL: endpoint,
    headers: {
      Authorization: "Bearer " + this.config.apiKey,
      "Content-Type": "application/json",
    },
    timeout: 300_000, // 5 分钟超时
  });
}
```

**带重试的拦截器**：

```typescript
this.client.interceptors.response.use(
  (response) => response,
  async (err) => {
    const cfg = err.config;
    cfg.__retryCount = cfg.__retryCount ?? 0;

    // 429（限流）、500-503（服务端错误）、网络错误时重试
    const status = err.response?.status;
    const shouldRetry =
      (!err.response || status === 429 || (status >= 500 && status <= 503)) &&
      cfg.__retryCount < 3;

    if (shouldRetry) {
      cfg.__retryCount++;
      const delay = Math.min(1000 * Math.pow(2, cfg.__retryCount - 1), 10_000);
      await new Promise((r) => setTimeout(r, delay)); // 指数退避
      return this.client(cfg);
    }
    return Promise.reject(err);
  }
);
```

## 第二步：构建 Tool Calling 请求

DeepSeek 使用 OpenAI 格式的工具定义：

```typescript
const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "bash",
      description: "执行 Shell 命令",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "要执行的命令"
          }
        },
        required: ["command"]
      }
    }
  },
  // ... 更多工具
];
```

发送请求：

```typescript
const response = await this.client.post("/chat/completions", {
  model: this.config.model, // "deepseek-chat"
  messages: this.messages,   // 完整的对话历史
  tools: toolDefinitions,    // 工具定义列表
  max_tokens: 4096,
});
```

## 第三步：解析响应

LLM 的响应有两种情况：

```typescript
const choice = response.data.choices[0];
const message = choice.message;

if (!message.tool_calls || message.tool_calls.length === 0) {
  // 情况1：纯文本回答 → 循环结束
  return message.content;
}

// 情况2：包含 tool_calls → 需要执行工具
for (const tc of message.tool_calls) {
  const funcName = tc.function.name;
  const args = JSON.parse(tc.function.arguments);

  // 执行工具
  const result = await dispatch(funcName, args);

  // 把工具结果追加到消息列表
  this.messages.push({
    role: "tool",
    tool_call_id: tc.id,
    content: result.output
  });
}
```

**关键细节**：每个 tool_call 的结果必须作为独立的 `role: "tool"` 消息返回，且 `tool_call_id` 必须匹配。这是 OpenAI API 的硬性要求。

## 第四步：完整循环代码

```typescript
async run(): Promise<string> {
  await this.initPromise; // 等待初始化完成

  for (let i = 0; i < this.config.maxIterations; i++) {
    this.turnCount++;

    // Token 预算检查（后续会详细讲）
    if (this.tokenBudget.shouldNudge()) {
      const nudge = this.tokenBudget.buildNudgeMessage();
      this.messages.push({ role: "user", content: nudge });
    }

    // 构建系统提示词（Pipeline Sections）
    const systemPrompt = await this.buildSystemPrompt();

    // 发送到 LLM
    const response = await this.client.post("/chat/completions", {
      model: this.config.model,
      messages: [
        { role: "system", content: systemPrompt },
        ...this.messages
      ],
      tools: this.getToolDefinitions(),
      max_tokens: 4096,
    });

    const message = response.data.choices[0].message;

    // 追加 assistant 消息到上下文
    this.messages.push(message);

    // 纯文本回答 → 结束
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content ?? "";
    }

    // 执行所有 tool_calls
    this.emit("turn_start", this.turnCount);

    for (const tc of message.tool_calls) {
      const startTime = Date.now();
      this.emit("tool_start", tc.function.name, tc.function.arguments);

      try {
        const args = JSON.parse(tc.function.arguments);
        const result = await this.pipeline.execute(tc, dispatch);

        this.emit("tool_result", tc.function.name, result.output, false);

        this.messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.output
        });
      } catch (err) {
        const errorOutput = err instanceof Error ? err.message : String(err);
        this.emit("tool_result", tc.function.name, errorOutput, true);

        this.messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: ${errorOutput}`
        });
      }
    }

    // 上下文压缩（Token 预算耗尽时）
    await this.maybeCompact();

    this.emit("turn_end", this.turnCount);
  }

  return "[达到最大迭代次数]";
}
```

## 第五步：上下文管理

对话历史会越来越长，必须管理。轻灵用两种策略：

### 策略1：Token 预算追踪

```typescript
class TokenBudgetManager {
  private totalBudget: number;
  private usedTokens = 0;
  private nudgeThreshold: number;

  // 每轮只计算新增的 token，不重算整个历史
  trackTurn(newMessages: Message[]): void {
    const newTokens = newMessages.length * 4 + 500; // 粗估
    this.usedTokens += newTokens;
  }

  shouldNudge(): boolean {
    return this.usedTokens > this.totalBudget * (1 - this.nudgeThreshold);
  }

  buildNudgeMessage(): string {
    return `⚠️ Token 预算已使用 ${Math.round(this.usedTokens / this.totalBudget * 100)}%，请尽快完成任务并给出最终回答。`;
  }
}
```

### 策略2：上下文压缩

当 Token 预算真的耗尽时，触发压缩：

```typescript
class ContextCompactor {
  private keepRecent = 6; // 保留最近 6 条消息
  private summarizerModel: string;

  async compact(messages: Message[]): Promise<Message[]> {
    // 1. 把旧消息用 LLM 总结成一段摘要
    const oldMessages = messages.slice(0, -this.keepRecent);
    const recentMessages = messages.slice(-this.keepRecent);

    const summary = await this.summarize(oldMessages);

    // 2. 确保 tool_call → tool_result 链完整
    return this.safeTruncate(messages, this.keepRecent);
  }
}
```

**⚠️ 重要陷阱**：压缩时必须保护 `assistant(tool_calls) → tool_result` 的配对关系。如果截断不当，API 会报错 `must be a response to preceding message with tool_calls`。我们在第4篇会详细讲这个问题。

## 第六步：错误处理与重试

Agent Loop 需要处理几类错误：

```typescript
// 1. API 调用失败 → 重试（已有拦截器）
// 2. 工具执行失败 → 追加错误消息，让 LLM 决定下一步
// 3. JSON 解析失败 → 重试解析
// 4. 工具被重复调用 → 计数器限制

const toolSignatureCounts = new Map<string, number>();

// 如果同一个工具+参数组合被调用超过 6 次
const sig = `${funcName}:${JSON.stringify(args)}`;
toolSignatureCounts.set(sig, (toolSignatureCounts.get(sig) ?? 0) + 1);
if (toolSignatureCounts.get(sig)! > this.config.runtime.toolRepeatLimit) {
  return { output: "Tool has been called too many times. Stop.", is_error: true };
}
```

## 完整数据流

```
用户: "帮我写一个 Hello World 的 Python 文件"

→ messages = [{ role: "user", content: "帮我写一个 Hello World 的 Python 文件" }]

→ POST /chat/completions (messages + tools)

→ LLM 返回:
   message.tool_calls = [{
     id: "call_1",
     function: { name: "write", arguments: '{"path":"hello.py","content":"print(\\"Hello, World!\\")"}' }
   }]

→ 执行 write 工具

→ 追加: { role: "tool", tool_call_id: "call_1", content: "✅ File written: hello.py" }

→ POST /chat/completions (messages + tools)

→ LLM 返回:
   message.content = "我已经创建了 hello.py 文件，里面包含一个打印 Hello, World! 的 Python 脚本。"
   message.tool_calls = null

→ 返回最终回答
```

## 小结

Agent Loop 的核心就是：
1. **发消息给 LLM** → **执行工具** → **追加结果** → **重复**
2. Token 预算管理防止上下文爆炸
3. 事件系统让 TUI 能实时展示执行过程

下一篇我们实现最酷的部分：**流式 TUI 终端界面**。

---

*上一篇：[从零搭建轻灵（一）：架构总览与技术选型](./01-architecture-overview.md)*
*下一篇：[从零搭建轻灵（三）：流式 TUI 终端界面](./03-streaming-tui.md)*
