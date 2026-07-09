# Qling SDK（雏形）

从 1.0 / Phase 2.0 起，可在 Node 项目中嵌入轻灵的 Agent 运行时。

## 安装

```bash
npm install @qlingzzy/qling
# 或: npm install github:Zzy-min/qling
```

## 最小示例

```js
import {
  AgentLoop,
  loadQlingConfig,
  applyConfigToProcessEnv,
  ALL_TOOLS,
} from "@qlingzzy/qling";

const { config } = await loadQlingConfig({
  workspaceDir: process.cwd(),
});
applyConfigToProcessEnv(config);

const agent = new AgentLoop({
  apiKey: process.env.QLING_LLM_API_KEY || process.env.DEEPSEEK_API_KEY,
  provider: config.llm.provider,
  endpoint: config.llm.endpoint,
  model: config.llm.model,
  tools: ALL_TOOLS,
  runtime: {
    workspaceDir: process.cwd(),
  },
});

agent.addUserMessage("列出当前目录的主要文件");
const answer = await agent.run();
console.log(answer);
await agent.shutdown();
```

## 主要导出

| 导出 | 用途 |
|------|------|
| `AgentLoop` | 核心 agent 循环 |
| `loadQlingConfig` / `applyConfigToProcessEnv` | 配置 |
| `listProviderPresets` / `getProviderPreset` | LLM 预设 |
| `listMcpPresets` / `addMcpPresetToStore` | MCP 预设与本机 store |
| `isPathAllowedForWrite` / `checkSensitiveWriteTarget` | 安全边界 |
| `runEvalSuite` | 本地评测 |
| `ALL_TOOLS` / `dispatch` | 工具层 |

## 边界

- SDK 与 CLI 共享同一运行时；**不**自动启动 TUI  
- API key 仍须由宿主进程提供（环境变量），SDK 不落盘密钥  
- 公开 API 在 2.x 可能调整；请 pin 版本  
- npm 包名为 `@qlingzzy/qling`（官方不允许无作用域名 `qling`）；全局安装后 CLI 命令仍是 `qling`

## CLI 仍推荐用于

- 交互 TUI、`/plan`、`/model`、doctor、daemon  
- `qling mcp add <preset>`  
- `npm run eval:smoke`  
