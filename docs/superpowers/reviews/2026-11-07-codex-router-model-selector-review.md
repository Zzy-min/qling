# 评审总结：对标 Codex Router 的模型选择器与路由优化

日期：2026-11-07
规格文档：`docs/superpowers/specs/2026-11-07-codex-router-model-selector-design.md`
实施计划：`docs/superpowers/plans/2026-11-07-codex-router-model-selector-plan.md`

## 1. 目标达成情况

对标 GitHub `duolahypercho/codex-router` 的架构理念与模型路由策略，全面升级了 `qling` 的模型选择器架构与交互体验：

1. **凭据感知与状态徽标 (Credential-Aware Status Badges)**：
   - 在 `src/providers/resolve-llm.ts` 中实现并导出了 `isProviderCredentialReady` 方法。
   - 细分支持五种就绪态徽标：`★ 当前`、`✓ 已就绪`、`⚡ 免Key`（本地模型/Ollama）、`🔒 账号`（ChatGPT/Grok 托管会话）、`○ 需配Key`（明确提示缺少哪个具体环境变量如 `DEEPSEEK_API_KEY`）。

2. **多层级提供商分组与可折叠 Section (Grouped Provider Sections)**：
   - 摆脱了原本仅局限于当前单服务商切换的局限，按国内推荐（DeepSeek/Qwen/GLM/Kimi/MiniMax/MiMo/SiliconFlow）、国际主流（OpenAI/Anthropic/Gemini/Mistral/OpenRouter/xAI）、本地部署（Ollama）和托管账号（ChatGPT/Grok）清晰分类。
   - 每个 Provider 板块包含 Section 计数（`sectionCount`）与状态徽标。

3. **实时键入过滤支持 (`filterable: true`)**：
   - 在 `src/tui/model-picker.ts` 结合轻灵内置的 `overlay-panel` 浮层体系，开启 `filterable: true`。
   - 每个模型项注入别名（`aliases`），用户直接键入模型名（如 `kimi`、`flash`、`deepseek`）、厂商名或上下文尺寸，浮层面板即时响应过滤。

4. **架构解耦与独立命令模块化**：
   - 将原先堆叠在 `src/commands/claude-style.ts` 内部长达 400 行的 `/model` 命令抽取并独立重构至 `src/commands/model.ts`。
   - UI 组装与 TUI 规格逻辑彻底封装在 `src/tui/model-picker.ts` 中。
   - `claude-style.ts` 仅做统一 re-export，对已有所有调用方 100% 透明兼容。

5. **严密测试隔离与回归保障**：
   - 修复了此前测试运行时因 `applyActiveAuthProfile` 意外读取宿主机真实用户配置目录导致的环境污染问题。
   - 补充了全面的单测：`tests/unit/model-picker-tui.test.mjs` 与 `tests/unit/model-picker-grouping.test.mjs`。
   - 全工程回归测试运行通过，1799 项测试用例全部执行通过（0 fail, 2 skipped）。

---

## 2. 变更文件清单

| 文件 | 变更说明 |
|------|----------|
| `src/tui/model-picker.ts` | **新建**：专职模型选择器 TUI 模块，提供 `buildGroupedModelPickerSpec`（可折叠、分组、徽标、快捷过滤）与 `formatGroupedModelPickerLines`（终端降级文本）。 |
| `src/commands/model.ts` | **新建**：解耦独立的 `/model` 斜杠命令实现，完整覆盖 `list`、`--all`、`--current`、`--remote`、`status`、`use <preset>`、`<model>` 等子命令。 |
| `src/commands/claude-style.ts` | 移除原内嵌的大段模型选择器代码，re-export `src/commands/model.ts`。 |
| `src/providers/resolve-llm.ts` | 增加并导出 `isProviderCredentialReady` 凭据感知检测方法。 |
| `src/providers/presets.ts` | 规范化 `KNOWN_MODEL_WINDOWS`、`MODEL_PROVIDER_AFFINITY` 与分组数据提供方法。 |
| `src/config.ts` | 增加针对测试运行环境的隔离守卫，避免测试过程串入宿主机真实 active profile。 |
| `tests/unit/model-picker-tui.test.mjs` | **新建**：针对选择器 Spec 构造、分组、徽标与回退输出的专用单元测试。 |
| `tests/unit/model-picker-grouping.test.mjs` | 验证分组列表与模型过滤行为。 |
| `tests/unit/model-command.test.mjs` | 更新并验证 `/model` 命令与子选项。 |

---

## 3. 验证记录

- **全量回归测试**：
  `npm test` (`npm run build && node --experimental-test-module-mocks --test "tests/unit/**/*.test.mjs"`)
  结果：**1805 tests executed, 1803 passed, 0 failed, 2 skipped** (耗时 ~33.8s)。
- **模块专项测试**：
  `node --experimental-test-module-mocks --test "tests/unit/model-picker-tui.test.mjs" "tests/unit/model-command.test.mjs" "tests/unit/model-picker-grouping.test.mjs"`
  结果：**33 passed, 0 failed** (耗时 ~1.68s)。

## 4. 关键缺陷排查与修复说明

1. **TUI 输入草稿残留屏蔽故障**：
   - 现象：在交互式终端键入 `/model` 开启选择器时，原输入缓冲区残留 `"/model"`，导致 `streaming-tui.ts` 的 `filterSlashItems` 将其视作待检索前缀并将后续按键全部丢弃或无匹配。
   - 修复：在 `src/commands/model.ts` 中通过 `context.setInputDraft` 重置/同步检索草稿，支持无缝实时输入与过滤。
2. **多厂商模型检索缩写支持**：
   - 在 `src/tui/model-picker.ts` 引入 `PROVIDER_ALIASES` 词典，用户键入 `qwen`、`kimi`、`claude`、`ds`、`gpt`、`glm`、`grok` 等缩写时均能瞬间定位到对应模型与厂商。
3. **跨厂商切换静默回退缺陷**：
   - 修复当用户在交互选择器中选择其它服务商的非 preset 模型、且缺少会话切换能力或未配置密钥时，避免静默回退调用 `applyModel` 错把异构模型指派给当前服务商的严重逻辑缺陷，改为精确提示并拦截。
4. **终端降级纯文本输出优化**：
   - 修复 `/model list --all` 降级文本未引用 `formatGroupedModelPickerLines` 的死代码问题，使非 TUI 环境亦能展示带凭据徽标的分组全景。

