# 对标 Codex Router 的轻灵（qling）模型选择器与路由优化设计

日期：2026-11-07
状态：已批准实施（Approved）

## 1. 目标与背景

借鉴并对标 `duolahypercho/codex-router`（Codex 外部模型路由与模型选择器体系），重构与优化 `qling` 的模型选择器及路由逻辑：

1. **结构解耦与模块化**：
   - 将原先嵌在 `src/commands/claude-style.ts` 中的庞大 `/model` 命令抽取并独立为标准命令模块 `src/commands/model.ts`。
   - 新建专职 UI 呈现与选择器构建模块 `src/tui/model-picker.ts`，彻底解耦展示与命令逻辑。
   - 保持向后兼容：`claude-style.ts` 和 `commands/index.ts` 统一重导出并引用。

2. **对标 Codex Router 的核心模型选择与路由特性**：
   - **全量提供商与模型目录分类**：
     - 国内主流厂商（DeepSeek、阿里云百炼 Qwen、智谱清言 GLM、月之暗面 Kimi、MiniMax、小米 MiMo、硅基流动 SiliconFlow）。
     - 国际前沿大模型（OpenAI GPT、Anthropic Claude、Google Gemini、Mistral AI、xAI Grok、OpenRouter）。
     - 本地离线引擎（Ollama / 本地部署）。
     - 账号直连模式（ChatGPT account、Grok account）。
     - 零密钥体验池（Free Auto 模式或免 key 服务商）。
   - **凭据感知（Credential-Awareness）与就绪状态标记**：
     - 对标 Codex Router 对模型可见性及可用性的凭据感知能力。
     - 实时探测提供商的凭据状态（环境变量、Session Key 或 Auth Profile）。
     - 在选择器中展示清晰徽标：
       - `★ 当前` / `● 当前`：当前会话正在使用的模型与提供商
       - `✓ 已就绪`：已配置对应 API Key 或无需 Key
       - `○ 需配Key`：未配置 API Key
       - `🔒 账号`：OAuth / CLI Session 直连
   - **交互式实时过滤检索（Filterable OptionPicker）**：
     - 支持交互式 TUI 实时敲字检索（`filterable: true`），按模型名、厂商名、上下文窗口（如 `1M`、`128k`）、别名快速模糊过滤。
     - 分组折叠与展开：支持 Provider Section 折叠，展示每个分类下的模型数量。
   - **安全路由与跨服务商切换**：
     - 选当前服务商模型：秒切 Model，无需重复校验。
     - 跨服务商切换：严格遵循单一服务商密钥安全隔离原则，若目标服务商已配置 Key 则无缝切换（provider + endpoint + model + key）；若缺少 Key 则给出精准友好的引导说明（例如提示 export 或 /login），杜绝会话破坏。
   - **下线迁移与智能退避提示**：
     - 识别已下线模型（如 `deepseek-chat` -> `deepseek-flash`）并给出迁移指引。

---

## 2. 详细设计

### 2.1 模块职责划分

```
src/
├── providers/
│   ├── presets.ts        # 预设底座、已知上下文窗口、模型归属、分组与目录定义
│   └── resolve-llm.ts    # 凭据解析、验证、凭据就绪检测 (isProviderCredentialReady)
├── tui/
│   └── model-picker.ts   # 模型选择器规格构建、分类 Section、徽标与实时过滤
└── commands/
    ├── model.ts          # /model 命令行及子命令交互执行器 (list, status, use, --remote)
    └── claude-style.ts   # 代理/重导出 modelCommand
```

### 2.2 数据模型与接口定义

在 `src/tui/model-picker.ts` 中定义选择器视图模型：
```ts
export interface ModelPickerOptions {
  currentProvider: string;
  currentModel: string;
  currentEndpoint?: string;
  filterMode?: "all" | "current" | "remote";
  remoteModels?: string[];
  env?: NodeJS.ProcessEnv;
  authStateDir?: string;
  onSelectPreset?: (presetId: string) => Promise<boolean | void>;
  onSelectModel?: (model: string, provider?: string) => Promise<void>;
  writeLine?: (line: string) => void;
  writeError?: (line: string) => void;
}
```

在 `src/providers/resolve-llm.ts` 扩展凭据状态感知接口：
```ts
export function isProviderCredentialReady(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
  authStateDir?: string
): { ready: boolean; reason?: string; requiresKey: boolean }
```

### 2.3 命令交互能力全景

- `/model`：在 TUI 模式下打开交互式分组过滤选择器（支持敲字过滤）；无 TUI 时打印分组清单。
- `/model list [--all|--current|--remote]`：
  - 默认/`--all`：全局按厂商分组浏览全部模型及凭据就绪状态。
  - `--current`：仅浏览当前服务商的已知模型。
  - `--remote`：向远端 `/models` 接口发送 live 探测并列出模型。
- `/model status`：显示当前模型、厂商、上下文窗口大小、最大输出 token、凭据状态及退避建议。
- `/model use <preset>`：快速切换到指定提供商预设（如 `/model use deepseek`, `/model use qwen`）。
- `/model <modelName>`：切换当前厂商下的模型名称。
- `/model help`：打印常用子命令及参数说明。

### 2.4 交互细节与防错设计

1. **输入草稿清理 (`setInputDraft`)**：
   - 打开选择器前调用 `context.setInputDraft(query)` 清空原命令残留，防止 `/model` 前缀使 TUI 误将输入识别为斜杠命令而屏蔽普通模型。
2. **多别名检索 (`PROVIDER_ALIASES`)**：
   - 注入厂商通用缩写别名（如 `ds`、`qwen`、`kimi`、`claude`、`gpt`、`glm`、`grok`），确保快速输入缩写即可瞬间定位到对应厂商及模型。
3. **跨厂商切换严格防护**：
   - 当用户选中另一厂商的模型时，优先通过会话级切换（`applyLlmSession`）；若环境或配置缺少对应支持，严格报错拦截，禁止静默回退并将该模型应用到当前错误厂商。

