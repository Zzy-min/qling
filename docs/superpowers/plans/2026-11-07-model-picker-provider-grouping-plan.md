# Qling 模型选择器按提供商分组实施计划

状态：准备实施（2026-11-07）

## 阶段 1：核心数据层扩展（`src/providers/presets.ts`）
- [ ] 导出 `GroupedProviderSection` 接口：
  - `providerId: string`
  - `displayName: string`
  - `isCurrent: boolean`
  - `entries: ProviderModelEntry[]`
- [ ] 实现 `listAllGroupedProviderModelEntries(currentProvider?: string, currentModel?: string): GroupedProviderSection[]`：
  - 遍历标准预设服务商序列 `PROVIDER_PRESET_ORDER`。
  - 针对每个提供商调用 `listProviderModelEntries(providerId, isCurrent ? currentModel : undefined)`。
  - 若 `currentProvider` 为不在预设列表中的自定义或未知服务商，在末尾或首部追加“自定义连接 (当前)”分组。
- [ ] 实现 `formatAllGroupedProviderModelLines(currentProvider?: string, currentModel?: string): string[]`：
  - 格式化输出带提供商分类标头的多行文本，供无 TUI 模式使用。

## 阶段 2：命令与选择器适配（`src/commands/claude-style.ts`）
- [ ] 调整 `openModelPicker()`：
  - 支持参数 `options?: { currentProviderOnly?: boolean }`。
  - 默认（全景模式）：基于 `listAllGroupedProviderModelEntries` 构造带 `section: true` 的条目流。
  - 每个分组前置一个 Header：
    ```typescript
    {
      id: `section:${group.providerId}`,
      label: group.displayName,
      section: true,
      collapsible: true,
      sectionCount: group.entries.length,
      disabled: true,
    }
    ```
  - 每个模型条目标注 `active`、`tag` 或 `hint`，当前正在运行的模型正确置为 `active`。
  - 切换器标题更新为 `模型切换 · 按服务商浏览`。
- [ ] 完善 `onPick` 逻辑：
  - 区分本服务商模型与跨服务商模型。
  - 跨服务商模型无论是否有独立 presetId，均能安全解析对应服务商的默认端点及所需 API Key，不产生脏状态。
- [ ] 参数兼容：
  - `/model list --current` 仅显示当前服务商模型（保留局域视图）。
  - `/model list` 或 `/model` 默认调用按提供商分组的全局视图。

## 阶段 3：测试编写与验证
- [ ] 创建 `tests/unit/model-picker-grouping.test.mjs`：
  - 测试 1：全局分组列表包含所有主线服务商（DeepSeek, Qwen, GLM, Kimi, OpenAI, Ollama 等）且条目结构正确。
  - 测试 2：切换器条目流包含 `section: true` 项，且每个 section 的 `sectionCount` 等于其子项数量。
  - 测试 3：当前模型在对应服务商 section 下标记为 `active: true`。
  - 测试 4：在选择器中选中其他服务商的模型时，能触发预设切换或凭据校验。
  - 测试 5：无 TUI 回退文本正确输出按提供商分组的格式。
- [ ] 执行全套自动化测试：`node --test tests/unit/model-picker-grouping.test.mjs tests/unit/model-command.test.mjs` 等。
- [ ] 运行构建 `npm run build`（或 `npx tsc`）。
- [ ] 本地新鲜验证与健康检查。
