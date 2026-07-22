# Qling SDK

`@qlingzzy/qling` 同时提供 CLI 和 Node.js ESM SDK。SDK 与 CLI 共享 AgentLoop、Provider gateway、工具、恢复语义和本地状态边界，但不会自动启动 TUI、Daemon 或 Dashboard。

## 安装

```bash
npm install @qlingzzy/qling --registry https://registry.npmjs.org/
```

npm 与 GitHub Release 可能不是同一版本；需要当前源码时可使用：

```bash
npm install github:Zzy-min/qling
```

## 最小示例：读取结构化终态

```js
import {
  AgentLoop,
  ALL_TOOLS,
  applyConfigToProcessEnv,
  loadQlingConfig,
} from "@qlingzzy/qling";

const { config } = await loadQlingConfig({
  workspaceDir: process.cwd(),
});
applyConfigToProcessEnv(config);

const agent = new AgentLoop({
  apiKey:
    process.env.QLING_LLM_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY,
  provider: config.llm.provider,
  endpoint: config.llm.endpoint,
  model: config.llm.model,
  tools: ALL_TOOLS,
  runtime: {
    workspaceDir: process.cwd(),
  },
});

try {
  agent.addUserMessage("只读列出当前目录的主要文件");
  const outcome = await agent.runDetailed();

  switch (outcome.status) {
    case "succeeded":
      console.log(outcome.text);
      break;
    case "paused":
      console.error("paused", outcome.runId, outcome.recovery);
      break;
    case "exhausted":
      console.error("exhausted", outcome.runId, outcome.iterations);
      break;
    case "failed":
      console.error("failed", outcome.failure);
      break;
    case "canceled":
      console.error("canceled", outcome.reason);
      break;
  }
} finally {
  await agent.shutdown();
}
```

`runDetailed()` 是需要可信终态时的推荐 API。兼容方法 `run(): Promise<string>` 仍保留：`succeeded`、`paused`、`exhausted` 返回文本，`failed` 和 `canceled` 抛错。

## RunOutcome

```ts
type RunOutcome =
  | { status: "succeeded"; runId: string; text: string }
  | { status: "paused"; runId: string; text: string; recovery: RecoveryState | null }
  | { status: "exhausted"; runId: string; text: string; iterations: number }
  | { status: "failed"; runId: string; text: string; failure: FailureClassification }
  | { status: "canceled"; runId: string; text: string; reason: string };
```

不要仅根据 `text` 判断任务完成；以 `status` 为准。

## 主要导出

| 导出 | 用途 |
|---|---|
| `AgentLoop` / `RunOutcome` | Agent 生命周期和结构化终态 |
| `LlmHttpClient` / `ProviderHttpError` | 当前 Provider 请求、状态码、重试语义和脱敏错误 |
| `loadQlingConfig` / `applyConfigToProcessEnv` | 配置加载与兼容环境映射 |
| `buildDefaultConfig` / `guardConfigFromEnv` | 默认配置与 guard 配置 |
| `listProviderPresets` / `getProviderPreset` | Provider 预设 |
| `listMcpPresets` / `addMcpPresetToStore` | MCP 预设与本机 store |
| `isPathAllowedForWrite` / `checkSensitiveWriteTarget` | 写沙箱和敏感目标检查 |
| `ALL_TOOLS` / `buildToolRegistry` / `createToolDispatcher` | 工具定义与 Agent 绑定 dispatcher |
| `runEvalSuite` / `buildEvalRepoTasks` | 本地评测与仓库 fixture |
| `getPackageVersion` / `formatCliVersion` | 版本读取与展示 |

`dispatch` 为兼容导出；并发或多 Agent 宿主应优先使用绑定到各自上下文的 `createToolDispatcher`，避免共享可变 registry。

## Provider 错误

`ProviderHttpError` 保留 provider、HTTP status、错误码、`Retry-After`、request ID、是否可重试与原始 cause。展示前仍需使用 Qling 的脱敏边界；不要直接记录请求 header 或密钥。

## 宿主责任

- 宿主进程提供 API key 或本地 Ollama endpoint；SDK 不落盘密钥。
- 始终在 `finally` 中调用 `agent.shutdown()`，释放 MCP 连接、Memory/WAL 生命周期和其他运行时资源。
- 并发 Agent 使用各自实例和 dispatcher，不要依赖进程级可变服务定位。
- 对 `paused` / `exhausted` 做显式业务处理，不要按成功继续流水线。
- SDK 在 2.0 前仍可能演进；生产使用请固定兼容版本并运行契约测试。

## 何时使用 CLI

以下场景优先使用 CLI：

- TUI、slash 命令、交互审批和 managed scrollback。
- `qling run ... --json` 的版本化 Headless 事件流。
- Daemon、Mission、Dashboard 与 ACP stdio。
- `qling setup`、`doctor`、`privacy`、`mcp` 等本地控制面。
