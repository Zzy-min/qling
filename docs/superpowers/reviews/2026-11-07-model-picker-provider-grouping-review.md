# Qling 模型选择器按提供商分组设计实现评审报告

- 日期：2026-11-07
- 目标：按照模型提供商（Provider）对模型选择器进行分类展示与跨服务商选择支持。

---

## 1. 变更范围与实现核对

### 1.1 数据层（`src/providers/presets.ts`）
- `ProviderModelEntry` 接口扩充 `provider?: string`，确保每个模型条目包含其提供商归属。
- 新增 `GroupedProviderSection` 接口及 `listAllGroupedProviderModelEntries(currentProvider, currentModel)`：
  - 按标准提供商顺序（`PROVIDER_PRESET_ORDER`）组织主流厂商分组（DeepSeek、阿里云百炼 Qwen、智谱清言 GLM、月之暗面 Kimi、MiniMax、Xiaomi MiMo、硅基流动、OpenAI、本地 Ollama、xAI 以及 ChatGPT/Grok 账号）。
  - 标识当前服务商（`isCurrent: true`），并将当前自定义/未知提供商自动归入首部分组。
- 新增 `formatAllGroupedProviderModelLines(currentProvider, currentModel)`，为无 TUI 终端提供清晰的多厂商分组文本列表。

### 1.2 命令与交互层（`src/commands/claude-style.ts`）
- `/model` 打开的选项切换器（`OptionPicker`）改用多分组布局：
  - 标题调整为 `模型切换 · 按服务商浏览`。
  - 每个厂商以 `section: true`、`collapsible: true`、`sectionCount` 呈现独立标头栏。
  - 当前会话模型准确标注 `active: true` 并显示 `● 当前`，打开时默认高亮。
- 完善 `onPick` 跨厂商选择逻辑：
  - 无论选中本厂商模型、预设项还是其他厂商的已知模型，均自动安全解析目标服务商 API Key 和端点，安全切换或给出清晰缺失凭据拦截。
- 保留 `--current` 参数（`/model list --current`），提供单厂商聚焦查看能力。

---

## 2. 验证结果

- **单元测试验证**：
  - `tests/unit/model-picker-grouping.test.mjs`：6 项新增测试全绿通过。
  - `tests/unit/model-command.test.mjs`：15 项测试全绿通过。
  - `tests/unit/provider-model-filter.test.mjs`：11 项测试全绿通过。
  - 全套模型相关 32 项自动化测试 100% 通过（32 pass, 0 fail）。
- **构建检查**：
  - `npm run build`：TypeScript 编译零错误，Dashboard 生产构建打包成功。
