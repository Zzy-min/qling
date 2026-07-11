# Phase 4 Capability Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地可选真实 LLM eval、轻量符号导航、可选 TypeScript 语义查询和依赖层扫描，同时保持默认 CI 完全本地。

**Architecture:** Phase 4 能力全部以 opt-in 或只读工具加入现有 registry。外部 LLM 与 Playwright 不进入默认强制链路；语义服务使用进程内 TypeScript LanguageService；依赖层扫描先报告债务，不在债务清零前启用 strict。

**Tech Stack:** TypeScript ESM、Node.js test runner、Axios、TypeScript LanguageService

## Global Constraints

- `eval:llm` 不进入默认 `ci:check`。
- `lsp` 默认关闭，仅在 `QLING_LSP=1` 时运行。
- `code_symbols` 只读且输出有文件数、节点数和命中数上限。
- 不新增多语言 LSP，不默认上传代码。

---

### Task 1: 可选真实 LLM eval

**Files:**
- Create: `src/eval/llm-tasks.ts`
- Create: `scripts/eval-llm.mjs`
- Modify: `package.json`
- Test: `tests/unit/eval-llm-gate.test.mjs`

**Interfaces:**
- Produces: `buildEvalLlmTasks(): EvalTask[]` 与 `npm run eval:llm`

- [ ] 写无开关/无 key 时 skip 的失败测试。
- [ ] 写本地 HTTP server 模拟 chat completion 的启用路径测试。
- [ ] 实现 gate、endpoint 规范化、超时与精确 `QOK` 断言。
- [ ] 验证默认 skip 和本地 enabled path 均通过。

### Task 2: 轻量 code_symbols

**Files:**
- Create: `src/tools/code-symbols.ts`
- Modify: `src/tools/index.ts`
- Test: `tests/unit/code-symbols.test.mjs`
- Modify: `src/eval/tasks.ts`

**Interfaces:**
- Produces: `searchCodeSymbols()` 与 `code_symbols` 工具

- [ ] 写临时 TS 文件符号命中测试。
- [ ] 写工作区越界、命中上限和节点预算测试。
- [ ] 复用 `extractSymbols` 实现只读检索并注册工具。
- [ ] 将本地符号检索加入 smoke eval。

### Task 3: 可选 TypeScript 语义查询

**Files:**
- Create: `src/lsp/ts-service.ts`
- Create: `src/tools/lsp.ts`
- Modify: `src/tools/index.ts`
- Test: `tests/unit/lsp.test.mjs`

**Interfaces:**
- Produces: `definition|hover|references|document_symbols` 与 service cache reset

- [ ] 写默认关闭和临时 TS project 查询测试。
- [ ] 写 runtime roots 越界、结果上限和文件刷新测试。
- [ ] 实现进程内 service、沙箱和结果钳制。
- [ ] 验证禁用路径不启动服务，启用路径返回新鲜结果。

### Task 4: 依赖层扫描与文档

**Files:**
- Create: `scripts/dep-layers.mjs`
- Create: `docs/architecture-layers.md`
- Create: `docs/dependency-layers.snapshot.json`
- Modify: `package.json`
- Test: `tests/unit/dep-layers.test.mjs`

**Interfaces:**
- Produces: `npm run dep:layers`、`npm run dep:layers:json` 和可选 `--strict`

- [ ] 写 fixture 覆盖合法向下依赖和反向边。
- [ ] 实现静态 import 扫描、稳定 JSON 和 strict exit code。
- [ ] 记录当前债务基线和拆包门槛。
- [ ] 在债务清零前保持默认脚本报告但不阻断 CI。

## Self-Review

- Spec coverage: 4.1-4.4 均有对应任务与验收入口。
- Placeholder scan: 无 TBD/TODO/implement later。
- Type consistency: eval 使用现有 `EvalTask`；工具使用现有 `ToolDefinition`/`ToolResult`。
