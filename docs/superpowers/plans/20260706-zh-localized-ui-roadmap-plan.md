# 轻灵中文本地化与 UI 体验增强实施计划（2026-07-06）

## 总体策略
按 Implementation Order 推进：**先写文档 → P0 → P1 → P2 → P3 → P4**。

每阶段：
- 独立小步提交
- 执行完整门禁（build + 相关测试 + ci:check + git diff --check + audit）
- 更新本计划进度

## Phase 0: 中文本地化文案与错误体验统一（P0）

### 目标
建立 `src/i18n/` 单一中文事实源 + 统一 guidance/error formatter。

### 具体任务
1. 完善 `src/i18n/zh-cn.ts`：
   - 覆盖 TUI 首屏、slash 命令面板、doctor、privacy、storage、setup、bootstrap、错误面板常用文案。
   - 提供清晰的中文标签（provider、模型、工具、密钥、隐私边界等）。
2. 统一 `formatLocalGuidancePanel` / error formatter：
   - 所有 CLI 错误（startup-contract）、slash 未知命令必须使用。
   - 固定输出结构：标题 + 原因 + 下一步 + 示例 + 本地执行 + 模型调用 + 边界。
3. 迁移剩余硬编码：
   - startup-contract 所有错误消息
   - slash commands 错误/帮助
   - setup、bootstrap、doctor、privacy 等关键文件
4. 调整 `runSetup()`（已部分完成）：
   - 确认 API key 绝不写入任何 .env
   - 只保存非敏感配置
   - 输出清晰的系统环境变量配置指导
5. 测试：
   - 新增/扩展 i18n.test.mjs、setup.test.mjs、cli-startup.test.mjs、slash-commands.test.mjs
   - 断言中文文案完整、错误面板格式统一、不泄露 secret
6. 门禁：build + 目标测试 + ci:check + 旧名扫描

### 约束
- 不改变现有命令解析和存储格式
- 保持候选命令提示和普通输入提示不变

## Phase 1: TUI 专属本地化界面升级（P1）

### 目标
在 CLI/TUI 层提供良好的中文工作台体验，优先 Windows 终端。

### 具体任务
1. TUI 首页（streaming-tui / shell / chrome）：
   - 显示：当前模型、workspace、记忆状态、权限模式、最近会话摘要、推荐 slash 命令。
2. `/` 命令面板分组（commands/index.ts + 相关视图）：
   - 常用 / 代码 / 记忆 / 上下文 / Git / 诊断 / 连接器 / 高级
3. 输出渲染增强：
   - Markdown 表格、列表、代码块、工具执行 timeline
   - 改善长输出处理和 Windows 宽字符对齐
4. 输入体验：
   - 继续改进多行输入、历史搜索、状态线
5. 测试：
   - 扩展 tui-*.test.mjs、slash-commands.test.mjs
   - 覆盖首页内容、slash 分组、表格渲染、宽字符
6. 门禁

### 约束
- 保持现有非全屏终端模式
- 不引入重型前端框架

## Phase 2: 本地 Web Dashboard 升级（P2）

### 目标
把占位页变成实用的本地只读可观测控制台。

### 具体任务
1. 审查当前 `dashboard-server.ts` 和静态资源。
2. 升级前端（静态 HTML + JS 或极轻模板）：
   - 会话列表 + 详情
   - 任务 / mission 状态
   - 工具调用 timeline
   - Token 使用
   - Memory 链接
   - Permissions 决策
   - Doctor / 状态快照
3. 仅暴露安全只读 + 有限控制：
   - pause/resume mission
   - 打开 session 详情
   - 导出报告
4. 确保 API 向后兼容（/api/metrics、/api/status、/api/missions 等）。
5. 默认关闭，显式启动。
6. 测试：新增 dashboard smoke 测试（可打开、只读、不调用模型、不联网）。
7. 门禁

## Phase 3: 中文知识库 / RAG 默认值（P3）

### 目标
实现 CLI/TUI 侧中文知识库最小闭环。

### 具体任务
1. 设计并实现 `qling knowledge` 子命令 或 `/knowledge` 入口。
2. 本地文件索引 + 中文友好 chunk 策略（按段落/标题/语义）。
3. 搜索 + 引用展示（返回来源片段 + 置信度）。
4. 默认推荐配置：
   - DeepSeek / Qwen / GLM / Ollama + 中文 embedding/rerank
5. 提供离线/私有化使用说明。
6. 测试：中文 chunk、搜索命中、引用链路、模型缺失友好提示。
7. 门禁（注意：不引入重型向量数据库依赖）

## Phase 4: 国内平台连接器引导（P4）

### 目标
提供易用的国内 IM/协作平台接入向导。

### 具体任务
1. 新增统一入口 `qling connect` / `/connect`。
2. 先完善现有 Telegram/Slack，再增加 Feishu / DingTalk / WeChat 规划。
3. 每个连接器：
   - 中文准备向导（材料、权限、token 存放）
   - 连通性测试
   - 常见失败 doctor 检查项
4. 敏感信息处理：
   - 不保存明文到 .env
   - 复用现有 scanner + doctor
5. 测试：缺 token、错误 token、成功配置、脱敏输出。
6. 门禁

## 总体验证与提交策略
- 每阶段完成后单独提交，消息清晰描述阶段。
- 持续执行：
  - `npm run build`
  - `npm run ci:check`
  - `git diff --check`
  - `npm audit --audit-level=high`
  - 旧名/硬编码扫描
- 最终交付：完整通过所有门禁，无安全回归。

## 当前进度追踪
- [x] 文档更新（spec + plan） — 已创建并在实施中迭代
- [x] P0 完成 + 门禁（i18n 覆盖核心 + formatter 统一 + setup 密钥安全 + 硬编码迁移部分 + 单元/相关smoke 全绿，build 通过）
- [ ] P1 完成 + 门禁
- [ ] P2 完成 + 门禁
- [ ] P3 完成 + 门禁
- [ ] P4 完成 + 门禁
- [ ] 最终回归 + 文档更新

**最新执行（2026-07-06）**:
- 完善 setup i18n + advanced prompts 迁移
- 增强 zh-cn.ts labels
- 核心单元测试 (i18n/setup/cli-startup/slash/tui) 全绿 (150+)
- smoke 全绿 (58/58)
- build + gates 通过
- 已提交: 84f005b feat(i18n): P0 ...
- 剩余 tui 变更待 P1 收敛
- 继续 P1 TUI 界面升级

