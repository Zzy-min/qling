# Qling 连接向导 UI 体验与模型目录实施计划 (Setup Wizard UX & Model Catalog Plan)

- **日期**: 2026-11-07
- **关联设计规范**: `docs/superpowers/specs/2026-11-07-setup-wizard-ux-and-model-catalog-spec.md`
- **目标**: 优化 `qling setup` 流程，使其对齐 Qling TUI 视觉风格，自动展示相关服务商的模型目录供快捷编号选择，支持缩写匹配，并保证所有现有测试与新测试通过。

---

## 阶段清单

### 阶段 1: 核心机制与向导重构
- [ ] **1.1 `src/providers/presets.ts` 补充与整理**:
  - 确保 `listProviderModelEntries` 对各主要提供商（如 deepseek, qwen, kimi, grok, openai, claude 等）能返回主流且最新的代表模型。
- [ ] **1.2 `src/cli/setup.ts` 视觉与逻辑重构**:
  - 增加 Qling 统一边框辅助函数（如 `renderBox` / `renderCard`）。
  - 美化首屏引导菜单（保留包含 `ChatGPT`、`Grok`、`API` 的关键词以兼容历史测试）。
  - 提供商选择支持别名解析（`getProviderPreset(input)`）。
  - 在模型选择阶段，若 `models` 为空，自动调用 `listProviderModelEntries(profile.provider, profile.model)` 填充，并以带序号的列表卡片优雅展示。
  - 用户输入序号 `1`、`2`... 可直接选中对应模型，回车使用默认推荐，或直接输入任意自定义模型 ID。
  - 在最终保存前展示 Qling 风格的边框配置摘要卡片。

---

### 阶段 2: 单元测试与验证
- [ ] **2.1 创建专属测试文件**: `tests/unit/setup-wizard-ux.test.mjs`
  - 测试 1: 选择 API Key 提供商（如 DeepSeek）时，向导自动输出候选模型列表。
  - 测试 2: 用户输入数字编号（如 `1`）时，正确选中对应模型 ID。
  - 测试 3: 用户直接回车时，正确使用首选默认模型。
  - 测试 4: 支持别名输入（如输入 `ds` 匹配 DeepSeek 提供商）。
  - 测试 5: 输出中包含 Qling 边框视觉元素与结构化配置卡片。
- [ ] **2.2 回归验证**:
  - 运行 `npm run build`
  - 运行 `node --test tests/unit/first-run-auth.test.mjs tests/unit/auth-final-regressions.test.mjs tests/unit/setup.test.mjs tests/unit/setup-wizard-ux.test.mjs`
  - 验证全部测试通过。

---

### 阶段 3: 评审与提交
- [ ] **3.1 编写评审记录**: `docs/superpowers/reviews/2026-11-07-setup-wizard-ux-and-model-catalog-review.md`
- [ ] **3.2 Git 提交与推送**:
  - 提交代码到 `codex/first-run-auth` 分支并推送到远程。
