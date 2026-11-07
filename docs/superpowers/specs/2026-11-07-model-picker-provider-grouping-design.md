# Qling 模型选择器按提供商分组设计

状态：待实施（2026-11-07）

## 1. 目标与背景

用户提出需求：“模型选择器能修改一下吗，按照模型提供商区分”。

此前在 Brief 13b 中，`/model` 切换器被限定为仅显示当前会话的服务商（`currentProvider`）的模型列表，导致用户在交互式 TUI 或命令中打开模型选择器时：
1. 无法看到其他可用模型提供商（如 DeepSeek、阿里云百炼 Qwen、智谱 GLM、Kimi、MiniMax、MiMo、OpenAI、Ollama、xAI 等）。
2. 模型选择器没有提供商分组维度，无法直观对比各厂商的可用模型。
3. 如果当前处于自定义或未知 endpoint，选择器列表更为空洞，无法直接通过选择器切换到其他提供商预设。

本设计的核心目标：
- 将模型选择器（`/model` TUI 切换器及无 TUI 时的列表输出）改造为**按模型提供商（Provider）清晰分类与分组展示**。
- 充分复用 `overlay-panel.ts` 现有的 `section`、`sectionCount`、`collapsible` 等分组组件特性，提供结构化、高可读性的交互体验。
- 允许用户跨提供商直接选中模型/预设并安全切换（复用现有的安全密钥解析与确认流程）。

---

## 2. 交互与展示设计

### 2.1 TUI 选项切换器（OptionPicker）结构

切换器标题：`模型切换 · 按服务商浏览`
底部提示：`↑/↓ 选择模型 · Enter 应用 · Esc 取消 · / 检索`

条目组织规则：
1. **分组标题（Section Header）**：
   - 遍历系统支持的所有标准提供商预设列表（`PROVIDER_PRESET_ORDER` 及当前自定义/账号连接）。
   - 每个服务商作为一个 Section：
     - `section: true`
     - `label: provider.displayName`（例如 `阿里云百炼 (Qwen)`、`DeepSeek`、`智谱清言 (GLM)`、`月之暗面 (Kimi)` 等）
     - `collapsible: true`
     - `sectionCount: 该服务商下的模型总数`
     - `disabled: true`（不可被选中回车，用于视觉和导航分组）
2. **分组内模型条目（Model Items）**：
   - 该服务商下的预设模型（`preset`）与官方现役/已知上下文窗口模型（`known`）。
   - 若当前会话属于该服务商且使用了未收录的自定义模型名，追加一条标注为“当前模型”。
   - 标注：
     - 当前正在使用的模型：`active: true`，显示 `● 当前`。
     - 描述信息：展示预设标识与目标模型名称，如 `deepseek · deepseek-flash`。
     - 初始聚焦：切换器打开时，`selectedId` 默认聚焦于当前会话正在使用的模型条目。
3. **当前未知/自定义服务商处理**：
   - 若当前会话连接的是未知提供商或自定义 endpoint，在最上方或末尾追加专属分组：`▼ 自定义连接 (当前)`，列出当前模型。

### 2.2 确认选择行为（onPick）

当用户在选择器中选中某一模型并按 Enter：
1. **选中项属于当前服务商**：
   - 若为预设项：调用 `applyPreset(presetId)`。
   - 若为纯模型项：调用 `applyModelOnly(modelName)`。
2. **选中项属于其他服务商**：
   - 若关联预设（`entry.presetId`）：调用 `applyPreset(presetId)`。
     - 校验目标服务商所需的 API Key（`resolveProviderApiKey`）。
     - 凭据齐全：自动切换会话的 provider、endpoint、model 与 apiKey，输出一行确认提示。
     - 凭据缺失：提示错误信息（如 `❌ 未配置 DASHSCOPE_API_KEY。请设置环境变量后重试。`），拒绝切换，保持当前会话不受破坏。
   - 若为该服务商的已知模型但无独立预设 ID：以该服务商的基准预设为底座，切换 endpoint/provider 并将 model 设置为所选模型。

### 2.3 无 TUI 终端回退（Fallback Text Output）

当无 TUI 环境（例如纯管道、无 raw mode 支持的终端）时，执行 `/model` 或 `/model list`：
- 输出当前会话状态（Provider、Model、Endpoint）。
- 按服务商分组打印模型清单：
  ```
  🤖 【模型 / Provider 清单】
  -----------------------------------------
  当前      : openai · codestral-latest
  Endpoint  : https://api.mistral.ai/v1

  [阿里云百炼 (Qwen)]
    - qwen3.7-plus (预设)
    - qwen-plus
  [DeepSeek]
    - deepseek-flash (预设)
    - deepseek-v4-pro
  [智谱清言 (GLM)]
    - glm-5.3 (预设)
    - glm-5.3-flash
    - glm-5.2
    - glm-4
  ...
  -----------------------------------------
  切换命令: /model use <preset> 或在交互模式直接回车选择
  ```

### 2.4 参数兼容性

- `/model`：默认打开按提供商分组的全局模型选择器。
- `/model list`：同默认行为。
- `/model list --current`：仅列出当前服务商的模型（保留 Brief 13b 的局域视图能力）。
- `/model list --remote`：向当前服务商发送 `/models` 远程探测。
- `/model use <preset>`：原有命令行快速切换行为完全不变。
- `/model <modelName>`：原有仅切换当前模型名行为完全不变。

---

## 3. 架构影响与文件变动

1. **`src/providers/presets.ts`**：
   - 增加辅助函数 `listAllGroupedProviderModelEntries(currentProvider, currentModel)`：
     - 按 `PROVIDER_PRESET_ORDER` 及当前未知/账号连接，聚合所有可用厂商及其归属模型。
     - 输出具备稳定分组结构的数据，避免调用方各处手写分组逻辑。
   - 增加按分组格式化文本行输出函数 `formatAllGroupedProviderModelLines(currentProvider, currentModel)`。
2. **`src/commands/claude-style.ts`**：
   - 更新 `modelCommand.execute` 中的 `openModelPicker()`：
     - 构建包含 Section 分组标题的 `OptionPickerItem[]`。
     - 设置 `title: "模型切换 · 按服务商浏览"`。
     - 适配 `onPick` 处理跨厂商预设与模型应用。
   - 回退文本输出对接按提供商分组的文本输出。
3. **测试覆盖**：
   - 验证模型选择器条目包含各大服务商的 section header。
   - 验证跨服务商条目点击后能够正确触发 `applyPreset` / 安全拒绝。
   - 验证当前激活模型在对应厂商分组下正确标记为 `active`。
   - 确保 `npm test` 中现有 1500+ 测试无回归。
