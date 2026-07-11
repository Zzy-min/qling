# Phase 3/4 Completion Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Phase 3/4 审计确认的运行边界缺口，并用本地可重复测试证明关键路径。

**Architecture:** 保持现有工具 API 和默认开关不变，在纯 helper 与现有执行入口补充边界校验。每个风险先以最小 RED 测试复现，再做局部实现；外部服务路径使用本地 server 或注入依赖验证。

**Tech Stack:** TypeScript ESM、Node.js test runner、Playwright、Axios、TypeScript LanguageService

**执行状态:** Tasks 1-8 已完成并通过验证；Tasks 9-11 为提交前代码审计新增。

## Global Constraints

- 不改变 slash command、session/memory 存储格式。
- browser_act、LSP、LLM eval 继续默认关闭。
- 不新增运行时依赖。
- 保留当前 dirty worktree 的既有改动，不回退、不覆盖无关内容。

---

### Task 1: 上下文输出硬上限

**Files:**
- Modify: `src/context-tool-hygiene.ts`
- Test: `tests/unit/context-tool-hygiene.test.mjs`

**Interfaces:**
- Consumes: `summarizeToolOutputForContext(output, options)`
- Produces: 最终长度受 max 控制的摘要和保结构 JSON 折叠

- [ ] 增加小 `maxChars` 配合默认 head/tail 的失败测试，断言结果不超过 max 加固定提示开销。
- [ ] 运行目标测试并确认因当前默认切片超限而失败。
- [ ] 按可用正文预算动态分配 head/tail，处理极小 max。
- [ ] 验证纯文本与 JSON 输出测试通过。

### Task 2: 子代理只读与计时器清理

**Files:**
- Modify: `src/agents/roles.ts`
- Modify: `src/agent/subtask.ts`
- Test: `tests/unit/subagent-roles.test.mjs`
- Test: `tests/unit/subtask.test.mjs`

**Interfaces:**
- Consumes: `filterToolsForRole()`、`SubtaskRunner.run()`
- Produces: 严格只读工具集和可清理的 timeout race

- [ ] 增加 explore/review 排除 `todo` 的失败测试。
- [ ] 增加可注入 runner/timeout 的生命周期测试，证明成功与超时均清理资源。
- [ ] 最小修改白名单与 `try/finally` 计时器清理。
- [ ] 运行角色和 subtask 测试。

### Task 3: browser_act 全请求 guard

**Files:**
- Modify: `src/tools/browser-act-session.ts`
- Modify: `src/tools/browser-act.ts`
- Test: `tests/unit/browser-act-session.test.mjs`
- Test: `tests/unit/browser-act.test.mjs`

**Interfaces:**
- Produces: session open 时可安装异步 request guard；导航失败时关闭新会话

- [ ] 用 fake context/page 增加 route handler 拒绝私网子资源的失败测试。
- [ ] 增加首次导航失败后 pool 不残留会话的失败测试。
- [ ] 安装 Playwright context route，复用现有 network guard 并 abort denied request。
- [ ] 在新建导航失败路径关闭 session，验证测试通过。

### Task 4: Mission Slack 响应语义

**Files:**
- Modify: `src/mission/progress-notify.ts`
- Test: `tests/unit/mission-progress-notify.test.mjs`

**Interfaces:**
- Produces: `assertSlackResponseOk(data)` 纯 helper 与正确 dispatch 状态

- [ ] 增加 `{ok:false,error:"channel_not_found"}` 判错测试。
- [ ] 验证 RED 后实现纯响应校验并在 progress/log 两条路径复用。
- [ ] 验证错误详情不含 token。

### Task 5: LSP 沙箱、上限与新鲜度

**Files:**
- Modify: `src/tools/lsp.ts`
- Modify: `src/lsp/ts-service.ts`
- Test: `tests/unit/lsp.test.mjs`

**Interfaces:**
- Produces: root guard、`limit <= 200`、磁盘版本刷新

- [ ] 增加 workspace 外绝对路径拒绝测试。
- [ ] 增加超大 limit 被钳制测试。
- [ ] 增加文件修改后 symbols/hover 使用新文本的测试。
- [ ] 实现 root guard、limit clamp 和 mtime/content 版本刷新。
- [ ] 运行 LSP 测试。

### Task 6: LLM eval 本地真实请求

**Files:**
- Modify: `src/eval/llm-tasks.ts`
- Test: `tests/unit/eval-llm-gate.test.mjs`

**Interfaces:**
- Produces: `resolveChatCompletionsUrl()` 和精确响应断言

- [ ] 使用本地 HTTP server 增加 `/v1` endpoint 不重复拼接的失败测试。
- [ ] 增加 `QOK extra` 必须失败的测试。
- [ ] 实现 URL 规范化和精确匹配。
- [ ] 运行 eval gate 测试并确认 pass/skip/fail 计数。

### Task 7: 遍历预算与门禁收尾

**Files:**
- Modify: `src/tools/code-symbols.ts`
- Modify: `tests/unit/code-symbols.test.mjs`
- Modify: `docs/skills.md`

**Interfaces:**
- Produces: 文件与节点双预算、干净 diff

- [ ] 增加大量非代码目录触发节点预算的失败测试。
- [ ] 实现节点预算和明确截断提示。
- [ ] 清理已知尾随空格。
- [ ] 运行 build、目标测试、`npm run ci:check`、`git diff --check`、旧名扫描、audit 和 pack dry-run。

### Task 8: npm 打包生命周期去重

**Files:**
- Modify: `package.json`
- Test: `tests/unit/package-metadata.test.mjs`

**Interfaces:**
- Produces: 单一 `prepare` 构建入口；`npm pack` 只执行一次 clean/build

- [x] 增加 package metadata 失败测试，断言存在 `prepare` 且不存在重复 `prepack`。
- [x] 运行测试并确认当前因 `prepack` 存在而失败。
- [x] 移除 `prepack`，保留 `prepare: npm run build`。
- [x] 串行执行 package metadata 测试、build、pack dry-run 与全局 CLI 启动验证。

### Task 9: Dream LLM 显式启用

**Files:**
- Modify: `src/agent-loop.ts`
- Test: `tests/unit/agent-loop-memory-local-first.test.mjs`

**Interfaces:**
- Produces: `resolveMemoryDreamLlmEnabled(env): boolean`

- [x] 写环境缺失/false 默认关闭和 true/1/on 显式开启的失败测试。
- [x] 运行测试并确认当前缺少导出且默认逻辑不符合要求。
- [x] 实现纯 resolver，并让 AgentLoop 初始化复用。
- [x] 运行目标测试与 AgentLoop 回归测试。

### Task 10: 远程 Discovery fail-closed

**Files:**
- Modify: `src/discovery-registry.ts`
- Modify: `src/agent-loop.ts`
- Test: `tests/unit/discovery-registry-security.test.mjs`

**Interfaces:**
- Produces: `DiscoveryRegistryOptions`，包含 `allowUnsigned`、`guardConfig`、`env`

- [x] 写默认拒绝 unsigned、显式允许、私网不请求、禁重定向、响应上限和畸形 manifest 拒绝测试。
- [x] 运行测试确认当前会无条件注册/发请求。
- [x] 接入 network Guard、显式 allowUnsigned 和 manifest 结构校验。
- [x] AgentLoop 将当前 guard 与显式环境开关传入 registry。
- [x] 运行 discovery、config 和 AgentLoop 回归测试。

### Task 11: browser_act 文档一致性

**Files:**
- Modify: `skills/opencli/SKILL.md`
- Test: `tests/unit/skill.test.mjs`

**Interfaces:**
- Produces: 与 session 实现一致的路由说明

- [x] 写内置 opencli skill 不包含“无跨步会话”且包含 session 保活说明的失败测试。
- [x] 修正文案并运行 skill 测试。

### Task 12: Discovery 运行时可执行性与审批 fail-closed

**Files:**
- Modify: `src/discovery-registry.ts`
- Modify: `src/agent-loop.ts`
- Test: `tests/unit/discovery-registry-security.test.mjs`

**Steps:**
- [x] RED：发现清单工具不能被当作当前可执行工具；`requireApproval` source 不得加载。
- [x] Registry 增加可执行工具查询边界，当前仅有 metadata 的 manifest 返回空。
- [x] AgentLoop 只注入可执行工具，并对仅发现 metadata 的情况输出诚实提示。
- [x] 运行 discovery 与 AgentLoop 回归测试。

### Task 13: Workflow checkpoint 安全恢复

**Files:**
- Modify: `src/workflow-types.ts`
- Modify: `src/workflow-runtime.ts`
- Test: `tests/unit/v0.3-features.test.mjs`

**Steps:**
- [x] RED：新 runtime 恢复 checkpoint 后仍可迁移到终态；路径型 runId 被拒绝。
- [x] checkpoint 持久化 workflow definition，resume 校验定义与 runId 后再恢复。
- [x] 缺失定义的旧 checkpoint 输出可操作错误，不改写原文件。
- [x] 运行 workflow、CLI resume 和全量回归测试。

### Task 14: Browser URL Guard 前置

**Files:**
- Modify: `src/tools/browser-act.ts`
- Test: `tests/unit/browser-act.test.mjs`

**Steps:**
- [x] RED：无会话 goto 私网 URL 被拒绝且 browser launcher 调用数为 0、pool 为空。
- [x] 将导航 URL Guard 前移到 session 获取/创建之前，移除重复的后置检查。
- [x] 运行 browser unit 与真实 browser E2E。

## Self-Review

- Spec coverage: Tasks 1-14 覆盖 2.1-2.14；依赖层 19 条债明确排除，不伪称清零。
- Placeholder scan: 无 TBD/TODO/implement later。
- Type consistency: 新 helper 均为内部纯函数，不改变现有公共工具调用签名。
