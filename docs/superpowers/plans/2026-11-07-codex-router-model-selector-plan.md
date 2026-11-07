# 实施计划：对标 Codex Router 的模型选择器与路由优化

日期：2026-11-07
设计文档：`docs/superpowers/specs/2026-11-07-codex-router-model-selector-design.md`

## 任务拆解与推进步骤

### Phase 1: 凭据感知与预设目录基底规范化（`src/providers/presets.ts` & `src/providers/resolve-llm.ts`）
- 1.1 恢复已知窗口表与预设默认值的规范性（使既有单元测试与实际现役模型兼顾：deepseek-flash, qwen3.7-plus, glm-5.3, kimi-k3, MiniMax-M3, etc.）。
- 1.2 确保 `RETIRED_MODELS` 映射正确（`deepseek-chat` -> `deepseek-flash`, `moonshot-v1-*` -> `kimi-k3` 等），退休模型窗口返回 null，不入已知模型列表，但若用户当前正在使用则标为当前模型。
- 1.3 在 `src/providers/resolve-llm.ts` 增加 `isProviderCredentialReady` 方法，支持快速判断厂商凭据就绪情况（支持 API Key、Local 免 key 以及 Auth Profile 账号检测）。

### Phase 2: 新建专职模型选择器 TUI 模块（`src/tui/model-picker.ts`）
- 2.1 封装 `buildGroupedModelPickerSpec` 函数，构建按提供商分组、带 Section 统计、徽标、凭据状态和上下文标签的 `OptionPickerSpec`。
- 2.2 支持 `filterable: true`，注入 `PROVIDER_ALIASES`（如 ds, qwen, kimi, claude），支持通过模型名、厂商名、别名、上下文窗口进行实时敲字过滤。
- 2.3 支持纯文本回退（无 TUI 或管道模式下的格式化打印输出 `formatGroupedModelPickerLines`）。
- 2.4 提供选择事件调度（同厂商秒切、跨厂商凭据验证与切换、异常提示拦截与严密防错）。

### Phase 3: 抽取与实现独立命令模块（`src/commands/model.ts`）
- 3.1 创建 `src/commands/model.ts`，导出 `modelCommand: SlashCommand`。
- 3.2 完整实现：
  - `/model` / `/model list [--all|--current|--remote]`
  - `/model status`
  - `/model use <preset>`
  - `/model <modelName>`
  - `/model help`
- 3.3 交互细节加固：调用 `context.setInputDraft` 清理 `/model` 残留，防止误触发命令匹配逻辑。
- 3.4 在 `src/commands/claude-style.ts` 中引入并重新导出 `modelCommand`，保持完全向后兼容。

### Phase 4: 修复环境隔离与回归测试
- 4.1 运行单元测试（`npm test`），验证所有既有与新增测试用例。
- 4.2 补充针对 `src/tui/model-picker.ts` 和 `src/commands/model.ts` 的单元测试（包含 inputDraft、别名与跨服务商错误路径）。
- 4.3 撰写 review 评审总结文档 `docs/superpowers/reviews/2026-11-07-codex-router-model-selector-review.md`。

